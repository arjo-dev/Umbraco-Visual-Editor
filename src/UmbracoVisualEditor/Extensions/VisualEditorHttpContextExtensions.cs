using UmbracoVisualEditor.Markers;
using Microsoft.AspNetCore.Http;

namespace UmbracoVisualEditor.Extensions;

/// <summary>Whether a request is for the Visual editor, for code that has the request but not a view's <c>Html</c>.</summary>
public static class VisualEditorHttpContextExtensions
{
    /// <summary>
    /// Whether this request renders a page for the Visual editor (a render session). True from routing on, so in
    /// templates, partials, view components and render controllers; false on the live site and in Umbraco's preview,
    /// where <c>UmbracoContext.InPreviewMode</c> is the check instead.
    /// <para>
    /// Markup that depends on it can't reach live visitors through caching: render sessions bypass the output cache and
    /// <c>CachedPartial</c>'s cache (see docs/compatibility.md).
    /// </para>
    /// </summary>
    public static bool IsVisualEditor(this HttpContext? context) => EditModeRequest.Get(context) is not null;
}
