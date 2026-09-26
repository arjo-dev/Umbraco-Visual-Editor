using Arjo.VisualEditor.Markers;
using Microsoft.AspNetCore.Mvc.Rendering;
using Umbraco.Cms.Core.Models.Blocks;
using Umbraco.Cms.Core.Models.PublishedContent;

namespace Arjo.VisualEditor;

/// <summary>
/// Opt-in helpers for templates the Visual editor can't read on its own (#38). See docs/compatibility.md.
/// Outside the Visual editor they write nothing.
/// </summary>
public static class VisualEditorHtmlHelperExtensions
{
    /// <summary>
    /// Marks the markup written inside the <c>using</c> as a block, so the Visual editor can select, move and edit it.
    /// Blocks are marked automatically when a view's model is the block (<see cref="IBlockReference"/>); use this where
    /// the markup is written some other way, e.g. a partial that only gets the block's element:
    /// <code>
    /// @foreach (var block in Model.Cards)
    /// {
    ///     using (Html.VisualEditorBlock(block))
    ///     {
    ///         @await Html.PartialAsync("Card", block.Content)
    ///     }
    /// }
    /// </code>
    /// </summary>
    public static IDisposable VisualEditorBlock(this IHtmlHelper html, IBlockReference block)
        => VisualEditorBlock(html, block.ContentKey, contentTypeKey: null);

    /// <summary>
    /// As <see cref="VisualEditorBlock(IHtmlHelper, IBlockReference)"/>, for when only the block's element is at hand.
    /// </summary>
    public static IDisposable VisualEditorBlock(this IHtmlHelper html, IPublishedElement content)
        => VisualEditorBlock(html, content.Key, content.ContentType.Key);

    private static IDisposable VisualEditorBlock(IHtmlHelper html, Guid contentKey, Guid? contentTypeKey)
    {
        EditModeRequest? editMode = EditModeRequest.Get(html.ViewContext.HttpContext);
        // Only the edited document's own blocks: not another page's rendered here too (see EditModeRequest.BlockKeys).
        if (editMode is null || !editMode.BlockKeys.Contains(contentKey))
        {
            return NoMarker.Instance;
        }

        // The same id the view engine would give it, so markers for one block nest rather than compete.
        var id = editMode.Markers.Register(MarkerKind.Block, contentKey, ownerIsBlock: true, contentTypeKey: contentTypeKey);
        TextWriter writer = html.ViewContext.Writer;
        writer.Write($"<!--uve:b:{id}-->");
        return new BlockMarker(writer, id);
    }

    private sealed class BlockMarker(TextWriter writer, int id) : IDisposable
    {
        public void Dispose() => writer.Write($"<!--/uve:b:{id}-->");
    }

    private sealed class NoMarker : IDisposable
    {
        public static readonly NoMarker Instance = new();

        public void Dispose()
        {
        }
    }
}
