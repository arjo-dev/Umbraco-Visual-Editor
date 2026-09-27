using UmbracoVisualEditor.Markers;
using Microsoft.AspNetCore.Mvc.Rendering;
using Umbraco.Cms.Core.Models.Blocks;
using Umbraco.Cms.Core.Models.PublishedContent;

namespace UmbracoVisualEditor;

/// <summary>
/// Opt-in helpers for templates the Visual editor can't read on its own (#38). See docs/compatibility.md.
/// Outside the Visual editor they write nothing.
/// </summary>
public static class VisualEditorHtmlHelperExtensions
{
    /// <summary>
    /// Marks the markup written inside the <c>using</c> as a block, so the Visual editor can select, move and edit it.
    /// Blocks are marked automatically when a view's model is the block (<see cref="IBlockReference"/>) or its content
    /// element; use this where there's no view per block, e.g. markup a loop writes itself:
    /// <code>
    /// @foreach (var block in Model.Cards)
    /// {
    ///     var card = (Card)block.Content;
    ///     using (Html.VisualEditorBlock(block))
    ///     {
    ///         &lt;article class="card"&gt;&lt;h3&gt;@card.Heading&lt;/h3&gt;&lt;/article&gt;
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
