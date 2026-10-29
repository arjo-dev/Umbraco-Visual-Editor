using System.Text.Encodings.Web;
using System.Text.Json;
using UmbracoVisualEditor.Markers;
using Microsoft.AspNetCore.Html;
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

    /// <summary>
    /// Marks where an empty Block List or Block Grid would be, so the Visual editor can show an "Add block" spot there
    /// (#97). Umbraco's <c>GetBlockListHtml</c> and <c>GetBlockGridHtml</c> write nothing at all for an empty value, not
    /// even their partial, so there's nothing on the page to mark. Put it next to the call:
    /// <code>
    /// @await Html.GetBlockGridHtmlAsync(Model, "bodyText")
    /// @Html.VisualEditorEmptyBlocks(Model, "bodyText")
    /// </code>
    /// Writes nothing on the live site, or when the property has blocks. In the Visual editor, an empty property gets
    /// an empty element with no height, which doesn't change the page's layout.
    /// </summary>
    /// <param name="html">The view's HTML helper.</param>
    /// <param name="owner">The document, or a block's content element, with the property.</param>
    /// <param name="propertyAlias">The Block List or Block Grid property's alias.</param>
    public static IHtmlContent VisualEditorEmptyBlocks(this IHtmlHelper html, IPublishedElement owner, string propertyAlias)
    {
        EditModeRequest? editMode = EditModeRequest.Get(html.ViewContext.HttpContext);
        if (editMode is null)
        {
            return HtmlString.Empty;
        }

        // The edited document, or one of its own blocks: not another page's rendered here too.
        var ownerIsBlock = owner.Key != editMode.Session.DocumentKey;
        if (ownerIsBlock && !editMode.BlockKeys.Contains(owner.Key))
        {
            return HtmlString.Empty;
        }

        IPublishedProperty? property = owner.GetProperty(propertyAlias);
        var editorAlias = property?.PropertyType.EditorAlias;
        if (property is null || !BlockContainerEditors.Contains(editorAlias!)
            || property.GetValue() is IEnumerable<IBlockReference> blocks && blocks.Any())
        {
            return HtmlString.Empty;
        }

        var spot = JsonSerializer.Serialize(
            new { ownerKey = owner.Key, ownerIsBlock, propertyAlias = property.Alias, editorAlias });
        return new HtmlString(
            $"<div data-uve-empty-blocks=\"{HtmlEncoder.Default.Encode(spot)}\" " +
            "style=\"display:block;height:0;margin:0;padding:0;border:0\"></div>");
    }

    /// <summary>Block editors whose empty value <see cref="VisualEditorEmptyBlocks"/> can mark.</summary>
    private static readonly HashSet<string> BlockContainerEditors = new(StringComparer.OrdinalIgnoreCase)
    {
        Umbraco.Cms.Core.Constants.PropertyEditors.Aliases.BlockList,
        Umbraco.Cms.Core.Constants.PropertyEditors.Aliases.BlockGrid,
    };

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
