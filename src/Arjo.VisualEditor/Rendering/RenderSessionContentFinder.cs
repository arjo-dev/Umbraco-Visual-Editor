using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Core.Routing;

namespace Arjo.VisualEditor.Rendering;

/// <summary>
/// Serves <c>/__visual-editor/render/{token}</c> as a normal front-end request for the session's overlaid document,
/// so templates, partials, helpers and ModelsBuilder models run exactly as on the live site.
/// </summary>
public sealed class RenderSessionContentFinder(RenderSessionStore sessions, OverlayContentBuilder builder) : IContentFinder
{
    public const string PathPrefix = "/__visual-editor/render/";

    public async Task<bool> TryFindContent(IPublishedRequestBuilder request)
    {
        var path = request.AbsolutePathDecoded;
        if (!path.StartsWith(PathPrefix, StringComparison.OrdinalIgnoreCase)
            || !Guid.TryParse(path[PathPrefix.Length..].Trim('/'), out Guid token)
            || sessions.Get(token) is not { } session)
        {
            return false;
        }

        IPublishedContent? content = await builder.BuildAsync(session);
        if (content is null)
        {
            return false;
        }

        if (!string.IsNullOrEmpty(session.Culture))
        {
            request.SetCulture(session.Culture);
        }

        request.SetPublishedContent(content);
        return true;
    }
}
