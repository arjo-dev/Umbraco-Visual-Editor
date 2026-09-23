using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Core.PropertyEditors;
using Umbraco.Extensions;

namespace Arjo.VisualEditor.Rendering;

/// <summary>
/// A published property whose source value comes from the editor's unsaved workspace value (already converted to
/// the stored format), run through the property type's normal value converters. Values are per culture/segment.
/// </summary>
internal sealed class OverlayPublishedProperty : IPublishedProperty
{
    private readonly IPublishedElement _owner;
    private readonly IPublishedProperty? _fallback;
    private readonly IVariationContextAccessor _variationContextAccessor;
    private readonly Dictionary<(string Culture, string Segment), object?> _sourceValues;
    private readonly Dictionary<(string Culture, string Segment), object?> _inters = new();
    private readonly Dictionary<(string Culture, string Segment), object?> _objects = new();

    public OverlayPublishedProperty(
        IPublishedPropertyType propertyType,
        IPublishedElement owner,
        IPublishedProperty? fallback,
        IVariationContextAccessor variationContextAccessor,
        Dictionary<(string Culture, string Segment), object?> sourceValues)
    {
        PropertyType = propertyType;
        _owner = owner;
        _fallback = fallback;
        _variationContextAccessor = variationContextAccessor;
        _sourceValues = sourceValues;
    }

    public IPublishedPropertyType PropertyType { get; }

    public string Alias => PropertyType.Alias;

    public bool HasValue(string? culture = null, string? segment = null)
    {
        if (!TryGetSource(culture, segment, out var source))
        {
            return _fallback?.HasValue(culture, segment) ?? false;
        }

        // Same order as Umbraco's published properties: converters may only answer at some levels, and some
        // (e.g. rich text) throw if asked at a level they don't expect.
        var hasValue = PropertyType.IsValue(source, PropertyValueLevel.Source);
        if (hasValue.HasValue)
        {
            return hasValue.Value;
        }

        var key = Key(culture, segment);
        hasValue = PropertyType.IsValue(GetInter(key, source), PropertyValueLevel.Inter);
        if (hasValue.HasValue)
        {
            return hasValue.Value;
        }

        var value = GetValue(culture, segment);
        return PropertyType.IsValue(value, PropertyValueLevel.Object) ?? value is not null;
    }

    public object? GetSourceValue(string? culture = null, string? segment = null)
        => TryGetSource(culture, segment, out var source) ? source : _fallback?.GetSourceValue(culture, segment);

    public object? GetValue(string? culture = null, string? segment = null)
    {
        if (!TryGetSource(culture, segment, out var source))
        {
            return _fallback?.GetValue(culture, segment);
        }

        var key = Key(culture, segment);
        if (!_objects.TryGetValue(key, out var value))
        {
            value = PropertyType.ConvertInterToObject(_owner, PropertyCacheLevel.None, GetInter(key, source), preview: true);
            _objects[key] = value;
        }

        return value;
    }

    private object? GetInter((string, string) key, object? source)
    {
        if (!_inters.TryGetValue(key, out var inter))
        {
            inter = PropertyType.ConvertSourceToInter(_owner, source, preview: true);
            _inters[key] = inter;
        }

        return inter;
    }

    public object? GetDeliveryApiValue(bool expanding, string? culture = null, string? segment = null)
        => _fallback?.GetDeliveryApiValue(expanding, culture, segment);

    private bool TryGetSource(string? culture, string? segment, out object? source)
        => _sourceValues.TryGetValue(Key(culture, segment), out source);

    // Views usually call Value(alias) without a culture: fill it in from the current request's variation context,
    // as Umbraco's own published properties do. Invariant properties are stored under an empty culture.
    private (string, string) Key(string? culture, string? segment)
    {
        _variationContextAccessor.ContextualizeVariation(PropertyType.Variations, Alias, ref culture, ref segment);
        return (PropertyType.Variations.VariesByCulture() ? culture ?? string.Empty : string.Empty,
            PropertyType.Variations.VariesBySegment() ? segment ?? string.Empty : string.Empty);
    }
}
