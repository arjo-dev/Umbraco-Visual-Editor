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
    /// even their partial, so there's nothing on the page to mark.
    /// <para>
    /// Views that import <c>UmbracoVisualEditor.Extensions</c> get this from those helpers already (see
    /// <see cref="Extensions.VisualEditorBlockTemplateExtensions"/>). Use it where a template renders a Block List or
    /// Grid some other way, e.g. its own loop:
    /// </para>
    /// <code>
    /// @foreach (var block in Model.Cards) { … }
    /// @Html.VisualEditorEmptyBlocks(Model, "cards")
    /// </code>
    /// Writes nothing on the live site, or when the property has blocks. In the Visual editor, an empty property gets
    /// an empty element with no height, which doesn't change the page's layout.
    /// </summary>
    /// <param name="html">The view's HTML helper.</param>
    /// <param name="owner">The document, or a block's content element, with the property.</param>
    /// <param name="propertyAlias">The Block List or Block Grid property's alias.</param>
    public static IHtmlContent VisualEditorEmptyBlocks(this IHtmlHelper html, IPublishedElement owner, string propertyAlias)
        => EditModeRequest.Get(html.ViewContext.HttpContext) is null
            ? HtmlString.Empty
            : EmptyBlocksMarker(html, owner.GetProperty(propertyAlias)?.GetValue());

    /// <summary>
    /// The marker for an empty Block List or Block Grid <paramref name="value"/>: an element with no height, where the
    /// Visual editor shows an "Add block" spot. Nothing outside the Visual editor, or for a value that isn't an empty one
    /// of the edited document (or its blocks); only those are remembered when their property converts them.
    /// </summary>
    internal static IHtmlContent EmptyBlocksMarker(IHtmlHelper html, object? value)
    {
        EmptyBlocksSpot? spot = EditModeRequest.Get(html.ViewContext.HttpContext)?.Markers.EmptyBlocksFor(value);
        if (spot is null)
        {
            return HtmlString.Empty;
        }

        var json = JsonSerializer.Serialize(new
        {
            ownerKey = spot.OwnerKey,
            ownerIsBlock = spot.OwnerIsBlock,
            propertyAlias = spot.PropertyAlias,
            editorAlias = spot.IsGrid
                ? Umbraco.Cms.Core.Constants.PropertyEditors.Aliases.BlockGrid
                : Umbraco.Cms.Core.Constants.PropertyEditors.Aliases.BlockList,
        });
        return new HtmlString(
            $"<div data-uve-empty-blocks=\"{HtmlEncoder.Default.Encode(json)}\" " +
            "style=\"display:block;height:0;margin:0;padding:0;border:0\"></div>");
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
