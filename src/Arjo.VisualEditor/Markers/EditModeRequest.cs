using Arjo.VisualEditor.Rendering;
using Microsoft.AspNetCore.Http;

namespace Arjo.VisualEditor.Markers;

/// <summary>
/// Per-request state for a render-session (edit mode) request. Its presence in <see cref="HttpContext.Items"/> is what
/// switches marker emission on; normal site requests never have it.
/// </summary>
public sealed class EditModeRequest(RenderSession session)
{
    private static readonly object ItemKey = new();

    public RenderSession Session { get; } = session;

    public MarkerRegistry Markers { get; } = new();

    private IReadOnlyDictionary<Guid, BlockPlacement>? _blockPlacements;

    /// <summary>Where each block of the edited document sits (#24), by content key; read from the session's values.</summary>
    public IReadOnlyDictionary<Guid, BlockPlacement> BlockPlacements
        => _blockPlacements ??= BlockLayout.Collect(Session.Values, Session.DocumentKey, Session.Culture);

    /// <summary>
    /// Content and settings keys of every block in the edited document's values, including nested blocks and
    /// grid areas. Only these are marked: other pages' blocks (e.g. a footer rendering the home page's blocks) aren't.
    /// </summary>
    public IReadOnlySet<Guid> BlockKeys { get; } = CollectBlockKeys(session.Values);

    private static HashSet<Guid> CollectBlockKeys(IEnumerable<RenderValue> values)
    {
        var keys = new HashSet<Guid>();
        foreach (RenderValue value in values)
        {
            Collect(value.Value, keys, inBlockData: false);
        }

        return keys;
    }

    // Block values (Block List/Grid, Single Block, blocks in rich text) keep their items in "contentData" and
    // "settingsData" arrays of objects with a "key"; nested block values sit inside those items' values.
    private static void Collect(System.Text.Json.JsonElement element, HashSet<Guid> keys, bool inBlockData)
    {
        switch (element.ValueKind)
        {
            case System.Text.Json.JsonValueKind.Object:
                if (inBlockData
                    && element.TryGetProperty("key", out var key)
                    && key.ValueKind == System.Text.Json.JsonValueKind.String
                    && Guid.TryParse(key.GetString(), out Guid parsed))
                {
                    keys.Add(parsed);
                }

                foreach (var property in element.EnumerateObject())
                {
                    Collect(property.Value, keys, property.NameEquals("contentData") || property.NameEquals("settingsData"));
                }

                break;

            case System.Text.Json.JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    Collect(item, keys, inBlockData);
                }

                break;
        }
    }

    public static EditModeRequest? Get(HttpContext? context)
        => context?.Items.TryGetValue(ItemKey, out var value) == true ? value as EditModeRequest : null;

    public static void Set(HttpContext context, EditModeRequest request) => context.Items[ItemKey] = request;
}
