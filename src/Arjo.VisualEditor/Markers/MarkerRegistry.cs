using System.Collections.Concurrent;
using System.Text.Json.Serialization;

namespace Arjo.VisualEditor.Markers;

public enum MarkerKind
{
    /// <summary>A property value rendered somewhere on the page (text, rich text).</summary>
    Property,

    /// <summary>The rendered output of one block (Block List, Block Grid, Single Block).</summary>
    Block,
}

/// <summary>
/// What a marker id points at. <see cref="OwnerKey"/> is the document key, or a block's content key when
/// <see cref="OwnerIsBlock"/> is set; the backoffice finds the block by content key in the document's block values.
/// </summary>
public sealed record MarkerInfo(
    int Id,
    [property: JsonConverter(typeof(JsonStringEnumConverter))] MarkerKind Kind,
    Guid OwnerKey,
    bool OwnerIsBlock,
    string? Alias,
    string? Culture,
    string? EditorAlias);

/// <summary>Assigns small integer ids to marker targets during one render; each target gets one id.</summary>
public sealed class MarkerRegistry
{
    private readonly ConcurrentDictionary<(MarkerKind, Guid, string?, string?), MarkerInfo> _markers = new();
    private int _nextId;

    public int Register(MarkerKind kind, Guid ownerKey, bool ownerIsBlock, string? alias = null, string? culture = null, string? editorAlias = null)
        => _markers.GetOrAdd(
            (kind, ownerKey, alias, culture),
            _ => new MarkerInfo(Interlocked.Increment(ref _nextId), kind, ownerKey, ownerIsBlock, alias, culture, editorAlias)).Id;

    public IReadOnlyList<MarkerInfo> All => _markers.Values.OrderBy(m => m.Id).ToList();
}
