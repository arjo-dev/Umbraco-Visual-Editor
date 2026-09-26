using System.Text.Json;
using UmbracoVisualEditor.Rendering;

namespace UmbracoVisualEditor.Markers;

/// <summary>
/// Where one block sits in the edited document (#24), for the canvas's block tools (move, insert, drag and drop):
/// which block editor property holds it and whose it is, its index there, and for Block Grid its area and spans.
/// </summary>
/// <param name="EditorAlias">The layout it is in: <c>Umbraco.BlockList</c>, <c>Umbraco.BlockGrid</c>, <c>Umbraco.SingleBlock</c> or <c>Umbraco.RichText</c>.</param>
/// <param name="PropertyAlias">The block editor property holding it.</param>
/// <param name="PropertyCulture">That property value's culture (null when invariant).</param>
/// <param name="OwnerKey">Whose property that is: the document key, or a block's content key.</param>
/// <param name="OwnerIsBlock">The property belongs to a block rather than the document.</param>
/// <param name="Index">Its position among its siblings (in the layout, or in its grid area).</param>
/// <param name="AreaKey">Block Grid: the area it is in, or null at the root of the grid.</param>
/// <param name="AreaOwnerKey">Block Grid: the content key of the block whose area it is in.</param>
/// <param name="ColumnSpan">Block Grid: columns it spans.</param>
/// <param name="RowSpan">Block Grid: rows it spans.</param>
/// <param name="SettingsKey">Its settings, if it has any.</param>
/// <param name="ContentTypeKey">Its element type.</param>
/// <param name="Path">Content keys of the blocks it is inside, outermost first.</param>
/// <param name="ContentTypeAlias">Its element type's alias; filled in when the manifest is written.</param>
public sealed record BlockPlacement(
    string EditorAlias,
    string PropertyAlias,
    string? PropertyCulture,
    Guid OwnerKey,
    bool OwnerIsBlock,
    int Index,
    Guid? AreaKey,
    Guid? AreaOwnerKey,
    int? ColumnSpan,
    int? RowSpan,
    Guid? SettingsKey,
    Guid? ContentTypeKey,
    IReadOnlyList<Guid> Path,
    string? ContentTypeAlias = null);

/// <summary>
/// Reads block placements from a render session's values: the raw block editor values, as the backoffice edits them.
/// Block values keep their structure in <c>layout</c> (<c>{ "Umbraco.BlockList": [ { contentKey, settingsKey } ] }</c>;
/// Block Grid items add <c>columnSpan</c>, <c>rowSpan</c> and <c>areas: [ { key, items } ]</c>) and their items in
/// <c>contentData</c>. Rich text keeps its blocks in <c>blocks</c>. Nested block values sit in the items' values.
/// </summary>
public static class BlockLayout
{
    public static IReadOnlyDictionary<Guid, BlockPlacement> Collect(IEnumerable<RenderValue> values, Guid documentKey, string? culture)
    {
        var placements = new Dictionary<Guid, BlockPlacement>();
        foreach (RenderValue value in values)
        {
            if (value.Segment is null && InCulture(value.Culture, culture))
            {
                VisitProperty(value.Alias, value.Culture, value.Value, documentKey, ownerIsBlock: false, [], culture, placements);
            }
        }

        return placements;
    }

    private static bool InCulture(string? valueCulture, string? culture)
        => valueCulture is null || string.Equals(valueCulture, culture, StringComparison.OrdinalIgnoreCase);

    private static void VisitProperty(
        string alias,
        string? propertyCulture,
        JsonElement value,
        Guid ownerKey,
        bool ownerIsBlock,
        IReadOnlyList<Guid> path,
        string? culture,
        Dictionary<Guid, BlockPlacement> placements)
    {
        if (value.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        // Rich text: { markup, blocks: { layout, contentData, … } }
        JsonElement blockValue = value.TryGetProperty("blocks", out JsonElement blocks) && blocks.ValueKind == JsonValueKind.Object
            ? blocks
            : value;
        if (!blockValue.TryGetProperty("layout", out JsonElement layout) || layout.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        var contentData = new Dictionary<Guid, JsonElement>();
        if (blockValue.TryGetProperty("contentData", out JsonElement items) && items.ValueKind == JsonValueKind.Array)
        {
            foreach (JsonElement item in items.EnumerateArray())
            {
                if (TryGuid(item, "key") is { } key)
                {
                    contentData[key] = item;
                }
            }
        }

        var context = new Context(alias, propertyCulture, ownerKey, ownerIsBlock, contentData, culture, placements);
        foreach (JsonProperty editor in layout.EnumerateObject())
        {
            if (editor.Value.ValueKind == JsonValueKind.Array)
            {
                VisitItems(editor.Name, editor.Value, areaKey: null, areaOwnerKey: null, path, context);
            }
        }
    }

    private sealed record Context(
        string PropertyAlias,
        string? PropertyCulture,
        Guid OwnerKey,
        bool OwnerIsBlock,
        Dictionary<Guid, JsonElement> ContentData,
        string? Culture,
        Dictionary<Guid, BlockPlacement> Placements);

    private static void VisitItems(
        string editorAlias,
        JsonElement items,
        Guid? areaKey,
        Guid? areaOwnerKey,
        IReadOnlyList<Guid> path,
        Context context)
    {
        var index = 0;
        foreach (JsonElement item in items.EnumerateArray())
        {
            if (TryGuid(item, "contentKey") is not { } contentKey)
            {
                continue;
            }

            context.ContentData.TryGetValue(contentKey, out JsonElement content);
            context.Placements.TryAdd(contentKey, new BlockPlacement(
                editorAlias,
                context.PropertyAlias,
                context.PropertyCulture,
                context.OwnerKey,
                context.OwnerIsBlock,
                index++,
                areaKey,
                areaOwnerKey,
                TryInt(item, "columnSpan"),
                TryInt(item, "rowSpan"),
                TryGuid(item, "settingsKey"),
                content.ValueKind == JsonValueKind.Object ? TryGuid(content, "contentTypeKey") : null,
                path));

            List<Guid> inside = [.. path, contentKey];

            // Block Grid areas: items of the same grid, inside this block.
            if (item.TryGetProperty("areas", out JsonElement areas) && areas.ValueKind == JsonValueKind.Array)
            {
                foreach (JsonElement area in areas.EnumerateArray())
                {
                    if (area.TryGetProperty("items", out JsonElement areaItems) && areaItems.ValueKind == JsonValueKind.Array)
                    {
                        VisitItems(editorAlias, areaItems, TryGuid(area, "key"), contentKey, inside, context);
                    }
                }
            }

            // Block editors among this block's own properties.
            if (content.ValueKind == JsonValueKind.Object
                && content.TryGetProperty("values", out JsonElement values)
                && values.ValueKind == JsonValueKind.Array)
            {
                foreach (JsonElement value in values.EnumerateArray())
                {
                    var alias = value.TryGetProperty("alias", out JsonElement a) ? a.GetString() : null;
                    var culture = value.TryGetProperty("culture", out JsonElement c) && c.ValueKind == JsonValueKind.String
                        ? c.GetString()
                        : null;
                    if (alias is not null && InCulture(culture, context.Culture) && value.TryGetProperty("value", out JsonElement v))
                    {
                        VisitProperty(alias, culture, v, contentKey, ownerIsBlock: true, inside, context.Culture, context.Placements);
                    }
                }
            }
        }
    }

    private static Guid? TryGuid(JsonElement element, string name)
        => element.TryGetProperty(name, out JsonElement value)
           && value.ValueKind == JsonValueKind.String
           && Guid.TryParse(value.GetString(), out Guid guid)
            ? guid
            : null;

    private static int? TryInt(JsonElement element, string name)
        => element.TryGetProperty(name, out JsonElement value)
           && value.ValueKind == JsonValueKind.Number
           && value.TryGetInt32(out var number)
            ? number
            : null;
}
