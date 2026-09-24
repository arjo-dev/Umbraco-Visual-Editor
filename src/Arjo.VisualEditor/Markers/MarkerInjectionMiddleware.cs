using System.Text;
using System.Text.Json;
using Arjo.VisualEditor.Rendering;
using Microsoft.AspNetCore.Http;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Services;

namespace Arjo.VisualEditor.Markers;

/// <summary>
/// For render-session responses: appends the marker manifest and the canvas script before <c>&lt;/body&gt;</c>,
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

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task InvokeAsync(HttpContext context, IContentTypeService contentTypeService)
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
            new { editMode.Session.DocumentKey, editMode.Session.Culture, Markers = SafeWithLabels(editMode.Markers.All, contentTypeService, SafePlacements(editMode)) },
            JsonOptions);
        var injection =
            $"<script type=\"application/json\" id=\"uve-markers\">{manifest.Replace("</", "<\\/")}</script>" +
            $"<script type=\"module\" src=\"{CanvasScriptPath}\"></script>";

        var bodyEnd = html.LastIndexOf("</body>", StringComparison.OrdinalIgnoreCase);
        html = bodyEnd >= 0 ? html.Insert(bodyEnd, injection) : html + injection;

        var bytes = Encoding.UTF8.GetBytes(html);
        context.Response.ContentLength = bytes.Length;
        await original.WriteAsync(bytes);
    }
}
