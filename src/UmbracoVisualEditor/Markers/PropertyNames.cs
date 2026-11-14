using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Services;

namespace UmbracoVisualEditor.Markers;

/// <summary>
/// A property's display name ("Cards") from its owner's content type, for labels on the page. The published model only
/// knows aliases, so names come from the content type service.
/// </summary>
internal static class PropertyNames
{
    /// <summary>The name of property <paramref name="alias"/> on <paramref name="type"/> or its compositions; null when it has none.</summary>
    public static string? Of(IContentType type, string? alias)
        => type.CompositionPropertyTypes.FirstOrDefault(p => p.Alias == alias)?.Name;

    /// <summary>
    /// The name of property <paramref name="alias"/> on content type <paramref name="contentTypeKey"/>. Null when there's
    /// no service or key, the type or property is unknown, or the lookup fails: names are for display only, and this runs
    /// while a template renders, so it must never break the page.
    /// </summary>
    public static string? Find(IContentTypeService? contentTypeService, Guid? contentTypeKey, string alias)
    {
        if (contentTypeService is null || contentTypeKey is not { } key)
        {
            return null;
        }

        try
        {
            return contentTypeService.Get(key) is { } type ? Of(type, alias) : null;
        }
        catch
        {
            return null;
        }
    }
}
