using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Extensions;

namespace Arjo.VisualEditor.Rendering;

/// <summary>
/// Wraps a document's draft <see cref="IPublishedContent"/> and replaces selected properties with
/// <see cref="OverlayPublishedProperty"/> instances built from unsaved editor values, and its name(s) with the
/// workspace's (possibly unsaved) variant names.
/// <c>Cultures</c> isn't virtual, so code reading <c>Cultures[culture].Name</c> (or the <c>Name(culture)</c> extension)
/// still sees the stored name; <c>Model.Name</c>, which templates normally use, follows unsaved renames.
/// </summary>
public sealed class OverlayPublishedContent : PublishedContentWrapped
{
    private readonly Dictionary<string, IPublishedProperty> _overrides;
    private readonly IReadOnlyList<RenderVariantName> _names;
    private readonly IVariationContextAccessor _variationContextAccessor;

    public OverlayPublishedContent(
        IPublishedContent content,
        IEnumerable<IPublishedProperty> overrides,
        IReadOnlyList<RenderVariantName> names,
        IVariationContextAccessor variationContextAccessor)
#if UMBRACO_17
        : base(content, UmbracoCompatibility.PublishedValueFallback)
#else
        : base(content)
#endif
    {
        _overrides = overrides.ToDictionary(p => p.Alias, StringComparer.OrdinalIgnoreCase);
        _names = names;
        _variationContextAccessor = variationContextAccessor;
    }

    public override IEnumerable<IPublishedProperty> Properties
        => base.Properties.Select(p => _overrides.TryGetValue(p.Alias, out var o) ? o : p);

    public override IPublishedProperty? GetProperty(string alias)
        => _overrides.TryGetValue(alias, out var property) ? property : base.GetProperty(alias);

    /// <summary>The name in the current culture (as Umbraco's own published content does).</summary>
    public override string Name
    {
        get
        {
            if (!ContentType.VariesByCulture())
            {
                return NameFor(null) ?? base.Name;
            }

            var culture = _variationContextAccessor.VariationContext?.Culture;
            return (culture is null ? null : NameFor(culture)) ?? base.Name;
        }
    }

    private string? NameFor(string? culture)
        => _names.FirstOrDefault(n =>
            string.Equals(n.Culture ?? string.Empty, culture ?? string.Empty, StringComparison.OrdinalIgnoreCase)
            && string.IsNullOrEmpty(n.Segment))?.Name is { Length: > 0 } name
            ? name
            : null;
}
