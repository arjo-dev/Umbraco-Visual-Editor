using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.AspNetCore.Mvc.ViewEngines;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Models.Blocks;

namespace Arjo.VisualEditor.Markers;

/// <summary>
/// Wraps the site's view engines so that, in edit mode, any partial whose model is a block
/// (<see cref="IBlockReference"/>: Block List, Block Grid, Single Block items) is surrounded by
/// <c>&lt;!--uve:b:{id}--&gt;</c> ... <c>&lt;!--/uve:b:{id}--&gt;</c>. Keyed on the model, not the view name, so it works
/// whatever the site calls its block views.
/// </summary>
internal sealed class BlockMarkingViewEngine(IViewEngine inner, IHttpContextAccessor httpContextAccessor) : IViewEngine
{
    public ViewEngineResult FindView(ActionContext context, string viewName, bool isMainPage)
        => Wrap(inner.FindView(context, viewName, isMainPage), isMainPage);

    public ViewEngineResult GetView(string? executingFilePath, string viewPath, bool isMainPage)
        => Wrap(inner.GetView(executingFilePath, viewPath, isMainPage), isMainPage);

    private ViewEngineResult Wrap(ViewEngineResult result, bool isMainPage)
        => result.Success && !isMainPage
            ? ViewEngineResult.Found(result.ViewName, new BlockMarkingView(result.View, httpContextAccessor))
            : result;

    private sealed class BlockMarkingView(IView inner, IHttpContextAccessor httpContextAccessor) : IView
    {
        public string Path => inner.Path;

        public async Task RenderAsync(ViewContext context)
        {
            EditModeRequest? editMode = EditModeRequest.Get(httpContextAccessor.HttpContext);
            if (editMode is null
                || context.ViewData.Model is not IBlockReference block
                || !editMode.BlockKeys.Contains(block.ContentKey))
            {
                await inner.RenderAsync(context);
                return;
            }

            // Same block key => same id, so nested partials for one block (e.g. a grid item's areas) share it.
            var id = editMode.Markers.Register(MarkerKind.Block, block.ContentKey, ownerIsBlock: true);
            await context.Writer.WriteAsync($"<!--uve:b:{id}-->");
            await inner.RenderAsync(context);
            await context.Writer.WriteAsync($"<!--/uve:b:{id}-->");
        }
    }
}

internal sealed class BlockMarkingViewOptionsSetup(IHttpContextAccessor httpContextAccessor) : IPostConfigureOptions<MvcViewOptions>
{
    public void PostConfigure(string? name, MvcViewOptions options)
    {
        for (var i = 0; i < options.ViewEngines.Count; i++)
        {
            if (options.ViewEngines[i] is not BlockMarkingViewEngine)
            {
                options.ViewEngines[i] = new BlockMarkingViewEngine(options.ViewEngines[i], httpContextAccessor);
            }
        }
    }
}
