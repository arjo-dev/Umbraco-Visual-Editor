using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Core.Strings;
using Umbraco.Extensions;

namespace Arjo.VisualEditor.Markers;

/// <summary>
/// Decorates a published property so its converted value carries a marker when the page renders it:
/// plain text gets an invisible <see cref="Stega"/> prefix; rich text (HTML) is wrapped in marker comments.
/// Other value types (numbers, dates, pickers, media) pass through unmarked.
/// </summary>
internal sealed class MarkedProperty(
    IPublishedProperty inner,
    Guid ownerKey,
    bool ownerIsBlock,
    MarkerRegistry registry,
    IVariationContextAccessor variationContextAccessor) : IPublishedProperty
{
    // Only free-text editors: marking dropdown/radio values etc. would break code that compares or uses them as
    // CSS classes, and URLs would stop working.
    private static readonly HashSet<string> TextEditors = new(StringComparer.OrdinalIgnoreCase)
    {
        Umbraco.Cms.Core.Constants.PropertyEditors.Aliases.TextBox,
        Umbraco.Cms.Core.Constants.PropertyEditors.Aliases.TextArea,
    };

    public IPublishedPropertyType PropertyType => inner.PropertyType;

    public string Alias => inner.Alias;

    public bool HasValue(string? culture = null, string? segment = null) => inner.HasValue(culture, segment);

    public object? GetSourceValue(string? culture = null, string? segment = null) => inner.GetSourceValue(culture, segment);

    public object? GetDeliveryApiValue(bool expanding, string? culture = null, string? segment = null)
        => inner.GetDeliveryApiValue(expanding, culture, segment);

    public object? GetValue(string? culture = null, string? segment = null)
    {
        // Our overlay values, and blocks we created, convert inside the marking scope so their nested blocks are marked.
        // A page property not overlaid is the cached draft: converting it must not mark (and so pollute) shared caches.
        var value = inner is Rendering.OverlayPublishedProperty || ownerIsBlock
            ? MarkingScope.Run(() => inner.GetValue(culture, segment))
            : inner.GetValue(culture, segment);
        switch (value)
        {
            case string text when text.Length > 0 && TextEditors.Contains(PropertyType.EditorAlias):
                return Stega.Encode(Register(culture, segment)) + text;

            case IHtmlEncodedString html:
                var id = Register(culture, segment);
                return new HtmlEncodedString($"<!--uve:p:{id}-->{html.ToHtmlString()}<!--/uve:p:{id}-->");

            default:
                return value;
        }
    }

    private int Register(string? culture, string? segment)
    {
        variationContextAccessor.ContextualizeVariation(PropertyType.Variations, Alias, ref culture, ref segment);
        return registry.Register(
            MarkerKind.Property,
            ownerKey,
            ownerIsBlock,
            Alias,
            PropertyType.Variations.VariesByCulture() ? culture : null,
            PropertyType.EditorAlias,
            PropertyType.ContentType?.Key);
    }
}
