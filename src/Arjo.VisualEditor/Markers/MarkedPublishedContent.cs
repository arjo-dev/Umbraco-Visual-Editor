using Umbraco.Cms.Core.Models.PublishedContent;

namespace Arjo.VisualEditor.Markers;

/// <summary>The edited document, with every property wrapped in a <see cref="MarkedProperty"/>.</summary>
internal sealed class MarkedPublishedContent : PublishedContentWrapped
{
    private readonly Dictionary<string, IPublishedProperty> _properties;

    public MarkedPublishedContent(IPublishedContent content, MarkerRegistry registry, IVariationContextAccessor variationContextAccessor)
#if UMBRACO_17
        : base(content, UmbracoCompatibility.PublishedValueFallback)
#else
        : base(content)
#endif
        => _properties = content.Properties.ToDictionary(
            p => p.Alias,
            p => (IPublishedProperty)new MarkedProperty(p, content.Key, ownerIsBlock: false, registry, variationContextAccessor),
            StringComparer.OrdinalIgnoreCase);

    public override IEnumerable<IPublishedProperty> Properties => _properties.Values;

    public override IPublishedProperty? GetProperty(string alias) => _properties.GetValueOrDefault(alias);
}


/// <summary>A block's content or settings element, with every property wrapped in a <see cref="MarkedProperty"/>.</summary>
/// <remarks>
/// <see cref="PublishedElementWrapped.Properties"/> and <see cref="PublishedElementWrapped.GetProperty"/> are virtual in
/// Umbraco 18 but not 17, so they can't be overridden on both. The interface is implemented again instead: models and
/// <c>Value()</c> read properties through <see cref="IPublishedElement"/>, which then finds these (#38).
/// </remarks>
#pragma warning disable CS0114 // Hides a virtual member (Umbraco 18); intended, see above.
internal sealed class MarkedPublishedElement : PublishedElementWrapped, IPublishedElement
{
    private readonly Dictionary<string, IPublishedProperty> _properties;

    public MarkedPublishedElement(IPublishedElement element, MarkerRegistry registry, IVariationContextAccessor variationContextAccessor)
#if UMBRACO_17
        : base(element, UmbracoCompatibility.PublishedValueFallback)
#else
        : base(element)
#endif
        => _properties = element.Properties.ToDictionary(
            p => p.Alias,
            p => (IPublishedProperty)new MarkedProperty(p, element.Key, ownerIsBlock: true, registry, variationContextAccessor),
            StringComparer.OrdinalIgnoreCase);

    public new IEnumerable<IPublishedProperty> Properties => _properties.Values;

    public new IPublishedProperty? GetProperty(string alias) => _properties.GetValueOrDefault(alias);
}
#pragma warning restore CS0114
