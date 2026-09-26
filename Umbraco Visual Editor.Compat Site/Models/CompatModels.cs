using Umbraco.Cms.Core.Models.Blocks;
using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Core.Strings;
using Umbraco.Extensions;

// Compiled models, written as ModelsBuilder writes them (#38): the site runs with ModelsBuilder "Nothing", so these
// are what Umbraco's default model factory creates, rather than InMemoryAuto's generated ones.
namespace Umbraco.Cms.Web.Common.PublishedModels;

[PublishedModel(ModelTypeAlias)]
public partial class CompatPage : PublishedContentModel
{
    public const string ModelTypeAlias = "compatPage";

    private readonly IPublishedValueFallback _publishedValueFallback;

    public CompatPage(IPublishedContent content, IPublishedValueFallback publishedValueFallback)
        : base(content, publishedValueFallback)
        => _publishedValueFallback = publishedValueFallback;

    public string? Title => this.Value<string>(_publishedValueFallback, "title");

    public IHtmlEncodedString? Body => this.Value<IHtmlEncodedString>(_publishedValueFallback, "body");

    /// <summary>Rendered by a hand-rolled loop whose partial gets each block.</summary>
    public BlockListModel? Cards => this.Value<BlockListModel>(_publishedValueFallback, "cards");

    /// <summary>Rendered by a hand-rolled loop whose partial only gets each block's element.</summary>
    public BlockListModel? MoreCards => this.Value<BlockListModel>(_publishedValueFallback, "moreCards");

    /// <summary>Rendered by a view component.</summary>
    public string? Sidebar => this.Value<string>(_publishedValueFallback, "sidebar");

    /// <summary>Rendered in a cached partial.</summary>
    public string? FooterNote => this.Value<string>(_publishedValueFallback, "footerNote");
}

[PublishedModel(ModelTypeAlias)]
public partial class CompatCard : PublishedElementModel
{
    public const string ModelTypeAlias = "compatCard";

    private readonly IPublishedValueFallback _publishedValueFallback;

    public CompatCard(IPublishedElement content, IPublishedValueFallback publishedValueFallback)
        : base(content, publishedValueFallback)
        => _publishedValueFallback = publishedValueFallback;

    public string? Heading => this.Value<string>(_publishedValueFallback, "heading");

    public string? Text => this.Value<string>(_publishedValueFallback, "text");
}
