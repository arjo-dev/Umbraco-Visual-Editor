using UmbracoVisualEditor.Configuration;
using UmbracoVisualEditor.Markers;
using Microsoft.AspNetCore.Html;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Rendering;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Models.Blocks;
using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Extensions;

namespace UmbracoVisualEditor.Extensions;

/// <summary>
/// Umbraco's Block List and Block Grid template helpers (<see cref="BlockListTemplateExtensions"/>,
/// <see cref="BlockGridTemplateExtensions"/>), the same calls with the same output, plus where an empty one would be
/// (#97). Umbraco's write nothing at all for an empty value, so the Visual editor couldn't show where to add its first
/// block; these add <see cref="VisualEditorHtmlHelperExtensions.VisualEditorEmptyBlocks"/>'s marker in that case.
/// <para>
/// No template changes: a view whose <c>Html</c> is an <see cref="IHtmlHelper{TModel}"/> (every Razor view) binds to
/// these rather than Umbraco's, since they take it exactly, once it imports this namespace. The package adds it as a
/// global using (<c>VisualEditorGlobalUsing</c>); views compiled at runtime (InMemoryAuto) need
/// <c>@using UmbracoVisualEditor.Extensions</c> in <c>_ViewImports.cshtml</c>. See docs/compatibility.md.
/// </para>
/// Outside the Visual editor, or with <see cref="VisualEditorOptions.AutoMarkEmptyBlocks"/> off, they only call
/// Umbraco's. This namespace holds nothing else, so importing it everywhere can't clash with a site's own names.
/// </summary>
public static class VisualEditorBlockTemplateExtensions
{
    #region Block List

    /// <inheritdoc cref="BlockListTemplateExtensions.GetBlockListHtmlAsync(IHtmlHelper, BlockListModel?, string)"/>
    public static async Task<IHtmlContent> GetBlockListHtmlAsync<TModel>(
        this IHtmlHelper<TModel> html, BlockListModel? model, string template = BlockListTemplateExtensions.DefaultTemplate)
        => WithEmptyMarker(html, model, await BlockListTemplateExtensions.GetBlockListHtmlAsync(html, model, template));

    /// <inheritdoc cref="BlockListTemplateExtensions.GetBlockListHtmlAsync(IHtmlHelper, IPublishedProperty, string)"/>
    public static Task<IHtmlContent> GetBlockListHtmlAsync<TModel>(
        this IHtmlHelper<TModel> html, IPublishedProperty property, string template = BlockListTemplateExtensions.DefaultTemplate)
        => GetBlockListHtmlAsync(html, property.GetValue() as BlockListModel, template);

    /// <inheritdoc cref="BlockListTemplateExtensions.GetBlockListHtmlAsync(IHtmlHelper, IPublishedContent, string)"/>
    public static Task<IHtmlContent> GetBlockListHtmlAsync<TModel>(
        this IHtmlHelper<TModel> html, IPublishedContent contentItem, string propertyAlias)
        => GetBlockListHtmlAsync(html, contentItem, propertyAlias, BlockListTemplateExtensions.DefaultTemplate);

    /// <inheritdoc cref="BlockListTemplateExtensions.GetBlockListHtmlAsync(IHtmlHelper, IPublishedContent, string, string)"/>
    public static Task<IHtmlContent> GetBlockListHtmlAsync<TModel>(
        this IHtmlHelper<TModel> html, IPublishedContent contentItem, string propertyAlias, string template)
        => contentItem.GetProperty(propertyAlias) is { } property
            ? GetBlockListHtmlAsync(html, property, template)
            // Umbraco's says why there's no such property.
            : BlockListTemplateExtensions.GetBlockListHtmlAsync(html, contentItem, propertyAlias, template);

    /// <inheritdoc cref="BlockListTemplateExtensions.GetBlockListHtml(IHtmlHelper, BlockListModel?, string)"/>
    public static IHtmlContent GetBlockListHtml<TModel>(
        this IHtmlHelper<TModel> html, BlockListModel? model, string template = BlockListTemplateExtensions.DefaultTemplate)
        => WithEmptyMarker(html, model, BlockListTemplateExtensions.GetBlockListHtml(html, model, template));

    /// <inheritdoc cref="BlockListTemplateExtensions.GetBlockListHtml(IHtmlHelper, IPublishedProperty, string)"/>
    public static IHtmlContent GetBlockListHtml<TModel>(
        this IHtmlHelper<TModel> html, IPublishedProperty property, string template = BlockListTemplateExtensions.DefaultTemplate)
        => GetBlockListHtml(html, property.GetValue() as BlockListModel, template);

    /// <inheritdoc cref="BlockListTemplateExtensions.GetBlockListHtml(IHtmlHelper, IPublishedContent, string)"/>
    public static IHtmlContent GetBlockListHtml<TModel>(
        this IHtmlHelper<TModel> html, IPublishedContent contentItem, string propertyAlias)
        => GetBlockListHtml(html, contentItem, propertyAlias, BlockListTemplateExtensions.DefaultTemplate);

    /// <inheritdoc cref="BlockListTemplateExtensions.GetBlockListHtml(IHtmlHelper, IPublishedContent, string, string)"/>
    public static IHtmlContent GetBlockListHtml<TModel>(
        this IHtmlHelper<TModel> html, IPublishedContent contentItem, string propertyAlias, string template)
        => contentItem.GetProperty(propertyAlias) is { } property
            ? GetBlockListHtml(html, property, template)
            : BlockListTemplateExtensions.GetBlockListHtml(html, contentItem, propertyAlias, template);

    #endregion

    #region Block Grid

    /// <inheritdoc cref="BlockGridTemplateExtensions.GetBlockGridHtmlAsync(IHtmlHelper, BlockGridModel?, string)"/>
    public static async Task<IHtmlContent> GetBlockGridHtmlAsync<TModel>(
        this IHtmlHelper<TModel> html, BlockGridModel? model, string template = BlockGridTemplateExtensions.DefaultTemplate)
        => WithEmptyMarker(html, model, await BlockGridTemplateExtensions.GetBlockGridHtmlAsync(html, model, template));

    /// <inheritdoc cref="BlockGridTemplateExtensions.GetBlockGridHtmlAsync(IHtmlHelper, IPublishedProperty, string)"/>
    public static Task<IHtmlContent> GetBlockGridHtmlAsync<TModel>(
        this IHtmlHelper<TModel> html, IPublishedProperty property, string template = BlockGridTemplateExtensions.DefaultTemplate)
        => GetBlockGridHtmlAsync(html, property.GetValue() as BlockGridModel, template);

    /// <inheritdoc cref="BlockGridTemplateExtensions.GetBlockGridHtmlAsync(IHtmlHelper, IPublishedContent, string)"/>
    public static Task<IHtmlContent> GetBlockGridHtmlAsync<TModel>(
        this IHtmlHelper<TModel> html, IPublishedContent contentItem, string propertyAlias)
        => GetBlockGridHtmlAsync(html, contentItem, propertyAlias, BlockGridTemplateExtensions.DefaultTemplate);

    /// <inheritdoc cref="BlockGridTemplateExtensions.GetBlockGridHtmlAsync(IHtmlHelper, IPublishedContent, string, string)"/>
    public static Task<IHtmlContent> GetBlockGridHtmlAsync<TModel>(
        this IHtmlHelper<TModel> html, IPublishedContent contentItem, string propertyAlias, string template)
        => contentItem.GetProperty(propertyAlias) is { } property
            ? GetBlockGridHtmlAsync(html, property, template)
            : BlockGridTemplateExtensions.GetBlockGridHtmlAsync(html, contentItem, propertyAlias, template);

    /// <inheritdoc cref="BlockGridTemplateExtensions.GetBlockGridHtml(IHtmlHelper, BlockGridModel?, string)"/>
    public static IHtmlContent GetBlockGridHtml<TModel>(
        this IHtmlHelper<TModel> html, BlockGridModel? model, string template = BlockGridTemplateExtensions.DefaultTemplate)
        => WithEmptyMarker(html, model, BlockGridTemplateExtensions.GetBlockGridHtml(html, model, template));

    /// <inheritdoc cref="BlockGridTemplateExtensions.GetBlockGridHtml(IHtmlHelper, IPublishedProperty, string)"/>
    public static IHtmlContent GetBlockGridHtml<TModel>(
        this IHtmlHelper<TModel> html, IPublishedProperty property, string template = BlockGridTemplateExtensions.DefaultTemplate)
        => GetBlockGridHtml(html, property.GetValue() as BlockGridModel, template);

    /// <inheritdoc cref="BlockGridTemplateExtensions.GetBlockGridHtml(IHtmlHelper, IPublishedContent, string)"/>
    public static IHtmlContent GetBlockGridHtml<TModel>(
        this IHtmlHelper<TModel> html, IPublishedContent contentItem, string propertyAlias)
        => GetBlockGridHtml(html, contentItem, propertyAlias, BlockGridTemplateExtensions.DefaultTemplate);

    /// <inheritdoc cref="BlockGridTemplateExtensions.GetBlockGridHtml(IHtmlHelper, IPublishedContent, string, string)"/>
    public static IHtmlContent GetBlockGridHtml<TModel>(
        this IHtmlHelper<TModel> html, IPublishedContent contentItem, string propertyAlias, string template)
        => contentItem.GetProperty(propertyAlias) is { } property
            ? GetBlockGridHtml(html, property, template)
            : BlockGridTemplateExtensions.GetBlockGridHtml(html, contentItem, propertyAlias, template);

    #endregion

    /// <summary>Umbraco's output, followed by the empty-blocks marker when <paramref name="model"/> is an empty one.</summary>
    private static IHtmlContent WithEmptyMarker(IHtmlHelper html, object? model, IHtmlContent content)
    {
        HttpContext context = html.ViewContext.HttpContext;
        if (EditModeRequest.Get(context) is null
            || context.RequestServices.GetService<IOptionsMonitor<VisualEditorOptions>>()?.CurrentValue.AutoMarkEmptyBlocks == false)
        {
            return content;
        }

        IHtmlContent marker = VisualEditorHtmlHelperExtensions.EmptyBlocksMarker(html, model);
        return ReferenceEquals(marker, HtmlString.Empty)
            ? content
            : new HtmlContentBuilder().AppendHtml(content).AppendHtml(marker);
    }
}
