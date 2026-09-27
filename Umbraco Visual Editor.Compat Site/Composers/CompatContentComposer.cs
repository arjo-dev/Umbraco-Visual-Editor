using System.Text.Json;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Notifications;
using Umbraco.Cms.Core.PropertyEditors;
using Umbraco.Cms.Core.Serialization;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Core.Strings;
using Umbraco.Cms.Web.Common.PublishedModels;

namespace Umbraco_Visual_Editor.Compat_Site.Composers;

/// <summary>
/// Creates the compatibility page (#38) on first boot: its element and document types, block list data types, template
/// and a published page at the root. In code rather than uSync, so the site has nothing but Umbraco and the package.
/// </summary>
public class CompatContentComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
        => builder.AddNotificationAsyncHandler<UmbracoApplicationStartedNotification, CreateCompatContent>();
}

public class CreateCompatContent(
    IRuntimeState runtimeState,
    IContentTypeService contentTypeService,
    IDataTypeService dataTypeService,
    ITemplateService templateService,
    IContentService contentService,
    PropertyEditorCollection propertyEditors,
    IConfigurationEditorJsonSerializer configurationSerializer,
    IShortStringHelper shortStringHelper,
    IWebHostEnvironment environment,
    ILogger<CreateCompatContent> logger)
    : INotificationAsyncHandler<UmbracoApplicationStartedNotification>
{
    public static readonly Guid PageKey = new("3c7f0b8e-0000-4f6c-9b1d-000000000001");
    private static readonly Guid CardTypeKey = new("3c7f0b8e-0000-4f6c-9b1d-000000000002");
    private static readonly Guid PageTypeKey = new("3c7f0b8e-0000-4f6c-9b1d-000000000003");

    public async Task HandleAsync(UmbracoApplicationStartedNotification notification, CancellationToken cancellationToken)
    {
        if (runtimeState.Level != RuntimeLevel.Run || contentTypeService.Get(PageTypeKey) is not null)
        {
            return;
        }

        logger.LogInformation("Creating the compatibility page");
        var superUser = Constants.Security.SuperUserKey;

        // The card: a heading and some text.
        var card = new ContentType(shortStringHelper, Constants.System.Root)
        {
            Key = CardTypeKey,
            Alias = CompatCard.ModelTypeAlias,
            Name = "Compat Card",
            Icon = "icon-card",
            IsElement = true,
        };
        card.AddPropertyType(Property(await DataType("Textstring"), "heading", "Heading"), "content", "Content");
        card.AddPropertyType(Property(await DataType("Textarea"), "text", "Text"), "content", "Content");
        await contentTypeService.CreateAsync(card, superUser);

        IDataType cards = await BlockList("Compat Cards");
        IDataType moreCards = await BlockList("Compat More Cards");
        IDataType inlineCards = await BlockList("Compat Inline Cards");

        // The page's template: the view is in Views/compatPage.cshtml, which the template keeps as it is.
        var view = await System.IO.File.ReadAllTextAsync(Path.Combine(environment.ContentRootPath, "Views", "compatPage.cshtml"), cancellationToken);
        var template = (await templateService.CreateAsync("Compat Page", CompatPage.ModelTypeAlias, view, superUser)).Result;

        var page = new ContentType(shortStringHelper, Constants.System.Root)
        {
            Key = PageTypeKey,
            Alias = CompatPage.ModelTypeAlias,
            Name = "Compat Page",
            Icon = "icon-layout",
            AllowedAsRoot = true,
        };
        page.AddPropertyType(Property(await DataType("Textstring"), "title", "Title"), "content", "Content");
        page.AddPropertyType(Property(await DataType("Richtext editor"), "body", "Body"), "content", "Content");
        page.AddPropertyType(Property(cards, "cards", "Cards"), "content", "Content");
        page.AddPropertyType(Property(moreCards, "moreCards", "More Cards"), "content", "Content");
        page.AddPropertyType(Property(inlineCards, "inlineCards", "Inline Cards"), "content", "Content");
        page.AddPropertyType(Property(await DataType("Textstring"), "sidebar", "Sidebar"), "content", "Content");
        page.AddPropertyType(Property(await DataType("True/false"), "hideSidebar", "Hide Sidebar"), "content", "Content");
        page.AddPropertyType(Property(await DataType("Textstring"), "footerNote", "Footer Note"), "content", "Content");
        page.AllowedTemplates = [template!];
        page.SetDefaultTemplate(template);
        await contentTypeService.CreateAsync(page, superUser);

        IContent content = contentService.Create("Compat", Constants.System.Root, page);
        content.Key = PageKey;
        content.TemplateId = template!.Id;
        content.SetValue("title", "Compatibility Page");
        content.SetValue("body", JsonSerializer.Serialize(new
        {
            markup = "<p>Rich text on a site with compiled models and no Clean.</p>",
            blocks = (object?)null,
        }));
        content.SetValue("cards", Blocks(
            ("3c7f0b8e-0000-4f6c-9b1d-0000000000a1", "First card", "Rendered by a hand-rolled loop; its partial gets the block."),
            ("3c7f0b8e-0000-4f6c-9b1d-0000000000a2", "Second card", "Also given the block, so it's marked automatically.")));
        content.SetValue("moreCards", Blocks(
            ("3c7f0b8e-0000-4f6c-9b1d-0000000000b1", "Element-only card", "Its partial only gets the element, and it's still marked."),
            ("3c7f0b8e-0000-4f6c-9b1d-0000000000b2", "Another element-only card", "Marked by its element.")));
        content.SetValue("inlineCards", Blocks(
            ("3c7f0b8e-0000-4f6c-9b1d-0000000000c1", "Inline card", "Written in the loop itself; the helper marks it."),
            ("3c7f0b8e-0000-4f6c-9b1d-0000000000c2", "Another inline card", "Marked with Html.VisualEditorBlock.")));
        content.SetValue("sidebar", "Written by a view component.");
        content.SetValue("footerNote", "Written by a cached partial.");
        contentService.Save(content);
        contentService.Publish(content, ["*"]);
    }

    private PropertyType Property(IDataType dataType, string alias, string name)
        => new(shortStringHelper, dataType, alias) { Name = name };

    private async Task<IDataType> DataType(string name)
        => await dataTypeService.GetAsync(name) ?? throw new InvalidOperationException($"No data type {name}");

    /// <summary>A Block List of cards.</summary>
    private async Task<IDataType> BlockList(string name)
    {
        var dataType = new DataType(propertyEditors[Constants.PropertyEditors.Aliases.BlockList]!, configurationSerializer)
        {
            Name = name,
            EditorUiAlias = "Umb.PropertyEditorUi.BlockList",
            ConfigurationData = new Dictionary<string, object>
            {
                ["blocks"] = new[] { new Dictionary<string, object> { ["contentElementTypeKey"] = CardTypeKey } },
            },
        };
        return (await dataTypeService.CreateAsync(dataType, Constants.Security.SuperUserKey)).Result;
    }

    /// <summary>A Block List value holding cards, in the stored format.</summary>
    private static string Blocks(params (string Key, string Heading, string Text)[] cards)
        => JsonSerializer.Serialize(new
        {
            layout = new Dictionary<string, object>
            {
                [Constants.PropertyEditors.Aliases.BlockList] = cards.Select(c => new { contentKey = c.Key }).ToArray(),
            },
            contentData = cards.Select(c => new
            {
                contentTypeKey = CardTypeKey,
                key = c.Key,
                values = new object[]
                {
                    new { alias = "heading", value = c.Heading },
                    new { alias = "text", value = c.Text },
                },
            }).ToArray(),
            settingsData = Array.Empty<object>(),
            expose = cards.Select(c => new { contentKey = c.Key, culture = (string?)null, segment = (string?)null }).ToArray(),
        });
}
