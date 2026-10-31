using System.Collections.Concurrent;
using System.Runtime.CompilerServices;
using System.Text.Json.Serialization;

namespace UmbracoVisualEditor.Markers;

public enum MarkerKind
{
    /// <summary>A property value rendered somewhere on the page (text, rich text).</summary>
    Property,

    /// <summary>The rendered output of one block (Block List, Block Grid, Single Block).</summary>
    Block,
}

/// <summary>
/// What a marker id points at. <see cref="ContentTypeKey"/> is the owner's (page or block element) content type;
/// <see cref="Label"/> and <see cref="OwnerLabel"/> are display names filled in from it when the manifest is written. <see cref="OwnerKey"/> is the document key, or a block's content key when
/// <see cref="OwnerIsBlock"/> is set; the backoffice finds the block by content key in the document's block values.
/// Block markers also carry the block's <see cref="Block"/> placement (#24), added when the manifest is written.
/// </summary>
public sealed record MarkerInfo(
    int Id,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] MarkerKind Kind,
    Guid OwnerKey,
    bool OwnerIsBlock,
    string? Alias,
    string? Culture,
    string? EditorAlias,
    Guid? ContentTypeKey = null,
    string? Label = null,
    string? OwnerLabel = null,
    BlockPlacement? Block = null);

/// <summary>
/// Whose empty Block List or Block Grid a converted value is (#97): where a block added to it on the page goes.
/// <see cref="IsGrid"/> says which, from the value's type.
/// </summary>
internal sealed record EmptyBlocksSpot(Guid OwnerKey, bool OwnerIsBlock, string PropertyAlias, bool IsGrid);

/// <summary>Assigns small integer ids to marker targets during one render; each target gets one id.</summary>
public sealed class MarkerRegistry
{
    private readonly ConcurrentDictionary<(MarkerKind, Guid, string?, string?), MarkerInfo> _markers = new();
    private readonly ConditionalWeakTable<object, EmptyBlocksSpot> _emptyBlocks = new();
    private int _nextId;

    /// <summary>
    /// Remembers whose an empty block value is. Umbraco's helpers only get the value, which doesn't know its
    /// property, so each empty value is its own instance (see <see cref="MarkedProperty"/>), looked up here.
    /// </summary>
    internal void RegisterEmptyBlocks(object value, EmptyBlocksSpot spot) => _emptyBlocks.AddOrUpdate(value, spot);

    /// <summary>Whose empty Block List or Block Grid <paramref name="value"/> is; null when it isn't one we marked.</summary>
    internal EmptyBlocksSpot? EmptyBlocksFor(object? value)
        => value is not null && _emptyBlocks.TryGetValue(value, out EmptyBlocksSpot? spot) ? spot : null;

    public int Register(
        MarkerKind kind,
        Guid ownerKey,
        bool ownerIsBlock,
        string? alias = null,
        string? culture = null,
        string? editorAlias = null,
        Guid? contentTypeKey = null)
        => _markers.GetOrAdd(
            (kind, ownerKey, alias, culture),
            _ => new MarkerInfo(
                Interlocked.Increment(ref _nextId), kind, ownerKey, ownerIsBlock, alias, culture, editorAlias, contentTypeKey)).Id;

    public IReadOnlyList<MarkerInfo> All => _markers.Values.OrderBy(m => m.Id).ToList();
}
