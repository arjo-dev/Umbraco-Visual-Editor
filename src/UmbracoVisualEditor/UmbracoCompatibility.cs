#if UMBRACO_17
using Microsoft.Extensions.DependencyInjection;
using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Core.DependencyInjection;

namespace UmbracoVisualEditor;

/// <summary>
/// What building for Umbraco 17 needs (#38; <c>-p:UmbracoVersion=17.x</c> defines <c>UMBRACO_17</c>). Kept here so the
/// rest of the code reads the same for both versions.
/// </summary>
internal static class UmbracoCompatibility
{
    /// <summary>
    /// Umbraco 17's <see cref="PublishedContentWrapped"/> and <see cref="PublishedElementWrapped"/> take the value
    /// fallback in their constructors (18's don't). Resolved here, so the wrappers' own constructors are the same on both.
    /// </summary>
    public static IPublishedValueFallback PublishedValueFallback
        => StaticServiceProvider.Instance.GetRequiredService<IPublishedValueFallback>();
}
#endif
