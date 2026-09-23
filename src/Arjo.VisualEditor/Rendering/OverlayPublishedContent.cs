using Umbraco.Cms.Core.Models.PublishedContent;

namespace Arjo.VisualEditor.Rendering;

/// <summary>
/// Wraps a document's draft <see cref="IPublishedContent"/> and replaces selected properties with
/// <see cref="OverlayPublishedProperty"/> instances built from unsaved editor values.
/// </summary>
public sealed class OverlayPublishedContent : PublishedContentWrapped
{
    private readonly Dictionary<string, IPublishedProperty> _overrides;

    public OverlayPublishedContent(IPublishedContent content, IEnumerable<IPublishedProperty> overrides)
        : base(content)
        => _overrides = overrides.ToDictionary(p => p.Alias, StringComparer.OrdinalIgnoreCase);

    public override IEnumerable<IPublishedProperty> Properties
        => base.Properties.Select(p => _overrides.TryGetValue(p.Alias, out var o) ? o : p);

    public override IPublishedProperty? GetProperty(string alias)
        => _overrides.TryGetValue(alias, out var property) ? property : base.GetProperty(alias);
}
