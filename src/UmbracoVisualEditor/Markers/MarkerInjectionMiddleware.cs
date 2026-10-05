using System.Text;
using System.Text.Json;
using UmbracoVisualEditor.Rendering;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Models;
using UmbracoVisualEditor.Configuration;
using Umbraco.Cms.Core.Services;

namespace UmbracoVisualEditor.Markers;

/// <summary>
/// For render-session responses: appends the marker manifest and the canvas script before <c>&lt;/body&gt;</c>,
/// with the site's <see cref="RenderScriptPath"/> before it and its <see cref="RenderStylesheetPath"/> at the end of the
/// head (if it has them), all versioned by content,
/// and stops the response being cached or indexed. Other requests pass straight through.
/// </summary>
internal sealed class MarkerInjectionMiddleware(RequestDelegate next)
{
    /// <summary>
    /// Adds display names so the canvas and side panel can say "Title" or "Rich Text Row" rather than aliases and keys:
    /// a property's name, a block's content type name, and (for properties inside blocks) the block's type name.
    /// </summary>
    // Labels are for display only: if resolving them fails, the page still renders (with aliases instead).
    private static IReadOnlyList<MarkerInfo> SafeWithLabels(
        IReadOnlyList<MarkerInfo> markers,
        IContentTypeService contentTypeService,
        IReadOnlyDictionary<Guid, BlockPlacement> placements)
    {
        try
        {
            return WithLabels(markers, contentTypeService, placements);
        }
        catch
        {
            return markers;
        }
    }

    private static IReadOnlyList<MarkerInfo> WithLabels(
        IReadOnlyList<MarkerInfo> markers,
        IContentTypeService contentTypeService,
        IReadOnlyDictionary<Guid, BlockPlacement> placements)
    {
        // Block markers get their placement in the document (#24), with the element type's alias.
        markers = markers
            .Select(m => m.Kind == MarkerKind.Block && placements.TryGetValue(m.OwnerKey, out BlockPlacement? placement)
                ? m with { Block = placement, ContentTypeKey = m.ContentTypeKey ?? placement.ContentTypeKey }
                : m)
            .ToList();

        var keys = markers.Select(m => m.ContentTypeKey).OfType<Guid>().Distinct().ToArray();
        var types = keys.Length == 0
            ? new Dictionary<Guid, IContentType>()
            : contentTypeService.GetMany(keys).ToDictionary(t => t.Key);

        return markers.Select(m =>
        {
            if (m.ContentTypeKey is not { } key || !types.TryGetValue(key, out IContentType? type))
            {
                return m;
            }

            return m.Kind == MarkerKind.Block
                ? m with { Label = type.Name, Block = m.Block is null ? null : m.Block with { ContentTypeAlias = type.Alias } }
                : m with
                {
                    Label = type.CompositionPropertyTypes.FirstOrDefault(p => p.Alias == m.Alias)?.Name ?? m.Alias,
                    OwnerLabel = m.OwnerIsBlock ? type.Name : null,
                };
        }).ToList();
    }

    // Placements are for the canvas's block tools: if reading them fails, the page still renders (without them).
    private static IReadOnlyDictionary<Guid, BlockPlacement> SafePlacements(EditModeRequest editMode)
    {
        try
        {
            return editMode.BlockPlacements;
        }
        catch
        {
            return new Dictionary<Guid, BlockPlacement>();
        }
    }

    public const string CanvasScriptPath = "/App_Plugins/ArjoVisualEditor/canvas-runtime.js";

    /// <summary>
    /// A stylesheet a site can add to style its pages in the Visual editor only, for example where its scripts don't
    /// run as they do on the site. The package doesn't ship one, so it's linked only when the site has it.
    /// </summary>
    public const string RenderStylesheetPath = "/App_Plugins/ArjoVisualEditor/backoffice-render.css";

    /// <summary>
    /// A script a site can add to run on its pages in the Visual editor only, for example to set its widgets up again
    /// after a live re-render (the canvas's <c>visual-editor:rendered</c> event). Like the stylesheet, the package
    /// doesn't ship one, so it's loaded only when the site has it.
    /// </summary>
    public const string RenderScriptPath = "/App_Plugins/ArjoVisualEditor/backoffice-render.js";

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task InvokeAsync(
        HttpContext context,
        IContentTypeService contentTypeService,
        IWebHostEnvironment environment,
        IOptionsMonitor<VisualEditorOptions> options)
    {
        if (!context.Request.Path.StartsWithSegments(RenderSessionContentFinder.PathPrefix.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))
        {
            await next(context);
            return;
        }

        Stream original = context.Response.Body;
        using var buffer = new MemoryStream();
        context.Response.Body = buffer;
        try
        {
            await next(context);
        }
        finally
        {
            context.Response.Body = original;
        }

        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers["X-Robots-Tag"] = "noindex";
        // The URL holds the session token: don't pass it on to the page's images, fonts and links (#34).
        context.Response.Headers["Referrer-Policy"] = "no-referrer";
        // Only the backoffice (same origin) may frame it. Added to any policy the site sends; policies combine.
        context.Response.Headers.Append("Content-Security-Policy", "frame-ancestors 'self'");

        EditModeRequest? editMode = EditModeRequest.Get(context);
        var isHtml = context.Response.ContentType?.StartsWith("text/html", StringComparison.OrdinalIgnoreCase) == true;
        // Only successful renders get the manifest: its absence is how the canvas knows the template failed (#16).
        if (editMode is null || !isHtml || context.Response.StatusCode != StatusCodes.Status200OK)
        {
            buffer.Position = 0;
            await buffer.CopyToAsync(original);
            return;
        }

        var html = Encoding.UTF8.GetString(buffer.ToArray());
        var manifest = JsonSerializer.Serialize(
            new
            {
                editMode.Session.DocumentKey,
                editMode.Session.Culture,
                // Read by the canvas: whether text and rich text are edited on the page or only in the side panel.
                PropertyLevelEditing = options.CurrentValue.EnablePropertyLevelEditing,
                Markers = SafeWithLabels(editMode.Markers.All, contentTypeService, SafePlacements(editMode)),
            },
            JsonOptions);
        // Versioned by their content, so browsers don't go on with a cached copy after an upgrade or an edit. Checked each
        // time, so adding or removing the site's stylesheet or script needs no restart.
        IFileProvider files = environment.WebRootFileProvider;
        html = Inject(
            html,
            manifest,
            VersionedAsset.Url(files, CanvasScriptPath) ?? CanvasScriptPath,
            VersionedAsset.Url(files, RenderStylesheetPath),
            VersionedAsset.Url(files, RenderScriptPath));

        var bytes = Encoding.UTF8.GetBytes(html);
        context.Response.ContentLength = bytes.Length;
        await original.WriteAsync(bytes);
    }

    /// <summary>
    /// Adds the marker manifest, the site's render script if it has one (<paramref name="siteScriptUrl"/>) and the canvas
    /// script (<paramref name="scriptUrl"/>) before <c>&lt;/body&gt;</c> and, if the site has one
    /// (<paramref name="stylesheetUrl"/>), links the render stylesheet before <c>&lt;/head&gt;</c>: after the template's
    /// own styles, so it wins ties with them.
    /// </summary>
    internal static string Inject(
        string html,
        string manifest,
        string scriptUrl,
        string? stylesheetUrl,
        string? siteScriptUrl = null)
    {
        // The site's script is deferred, so it runs once the page is parsed, in order: before the canvas (a module) starts.
        var scripts =
            $"<script type=\"application/json\" id=\"uve-markers\">{manifest.Replace("</", "<\\/")}</script>" +
            (siteScriptUrl is null ? string.Empty : $"<script defer src=\"{siteScriptUrl}\"></script>") +
            $"<script type=\"module\" src=\"{scriptUrl}\"></script>";
        var link = stylesheetUrl is null ? string.Empty : $"<link rel=\"stylesheet\" href=\"{stylesheetUrl}\">";

        var headEnd = html.IndexOf("</head>", StringComparison.OrdinalIgnoreCase);
        if (headEnd < 0)
        {
            // No head: the link goes with the scripts, which still puts it after the page's styles.
            scripts = link + scripts;
            link = string.Empty;
        }

        var bodyEnd = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        html = bodyEnd >= 0 ? html.Insert(bodyEnd, scripts) : html + scripts;
        return headEnd >= 0 ? html.Insert(headEnd, link) : html;
    }
}
