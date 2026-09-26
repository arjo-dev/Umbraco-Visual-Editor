using Microsoft.AspNetCore.Http;

namespace UmbracoVisualEditor.Rendering;

/// <summary>
/// Only the backoffice user who created a render session may render it (#34): the URL alone isn't enough, so it's no
/// use to anyone it leaks to (a site's analytics, browser history, a screenshot).
/// <para>
/// The render page is a front-end request, which has no backoffice token; and the backoffice sign-in cookie only
/// lives for the sign-in itself. So, like Umbraco's preview cookie, creating a session (an authenticated API call from
/// the backoffice) also sets a cookie for render pages only, holding a pass for its user (see
/// <see cref="RenderSessionStore.IssueViewerPassAsync"/>).
/// </para>
/// </summary>
public static class RenderViewerCookie
{
    public const string Name = "UmbracoVisualEditor.Viewer";

    /// <summary>Only render pages (and the canvas fetching newer renders) get it.</summary>
    private const string Path = "/__visual-editor/";

    public static async Task IssueAsync(HttpContext context, RenderSessionStore sessions, Guid userKey)
    {
        var pass = await sessions.IssueViewerPassAsync(userKey, context.Request.Cookies[Name], context.RequestAborted);
        context.Response.Cookies.Append(Name, pass, new CookieOptions
        {
            Path = Path,
            HttpOnly = true,
            Secure = context.Request.IsHttps,
            SameSite = SameSiteMode.Strict,
            IsEssential = true,
        });
    }

    /// <summary>Whether the request carries a pass for <paramref name="userKey"/>.</summary>
    public static async Task<bool> IsForUserAsync(HttpContext? context, RenderSessionStore sessions, Guid userKey)
        => userKey != Guid.Empty
           && context is not null
           && await sessions.GetViewerAsync(context.Request.Cookies[Name], context.RequestAborted) == userKey;
}
