using Umbraco.Cms.Core.Models.PublishedContent;

namespace Arjo.VisualEditor.Markers;

/// <summary>The edited document, with every property wrapped in a <see cref="MarkedProperty"/>.</summary>
internal sealed class MarkedPublishedContent : PublishedContentWrapped
{
    private readonly Dictionary<string, IPublishedProperty> _properties;

    public MarkedPublishedContent(IPublishedContent content, MarkerRegistry registry, IVariationContextAccessor variationContextAccessor)
        : base(content)
        => _properties = content.Properties.ToDictionary(
            p => p.Alias,
            p => (IPublishedProperty)new MarkedProperty(p, content.Key, ownerIsBlock: false, registry, variationContextAccessor),
            StringComparer.OrdinalIgnoreCase);

    public override IEnumerable<IPublishedProperty> Properties => _properties.Values;

    public override IPublishedProperty? GetProperty(string alias) => _properties.GetValueOrDefault(alias);
}

/// <summary>A block's content or settings element, with every property wrapped in a <see cref="MarkedProperty"/>.</summary>
internal sealed class MarkedPublishedElement : PublishedElementWrapped
{
    private readonly Dictionary<string, IPublishedProperty> _properties;

    public MarkedPublishedElement(IPublishedElement element, MarkerRegistry registry, IVariationContextAccessor variationContextAccessor)
        : base(element)
        => _properties = element.Properties.ToDictionary(
            p => p.Alias,
            p => (IPublishedProperty)new MarkedProperty(p, element.Key, ownerIsBlock: true, registry, variationContextAccessor),
            StringComparer.OrdinalIgnoreCase);

    public override IEnumerable<IPublishedProperty> Properties => _properties.Values;

    public override IPublishedProperty? GetProperty(string alias) => _properties.GetValueOrDefault(alias);
}
