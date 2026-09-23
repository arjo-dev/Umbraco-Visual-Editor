using Microsoft.AspNetCore.Http;
using Umbraco.Cms.Core.Models.PublishedContent;

namespace Arjo.VisualEditor.Markers;

/// <summary>
/// Decorates the site's <see cref="IPublishedModelFactory"/>. During edit-mode requests only, the edited document
/// and each of its block elements (block converters create elements through this factory) are wrapped so their properties
/// emit markers, before the site's own ModelsBuilder model is applied on top.
/// Implements <see cref="IAutoPublishedModelFactory"/> by delegation so InMemoryAuto model reloading keeps working.
/// </summary>
internal sealed class MarkingPublishedModelFactory(
    IPublishedModelFactory inner,
    IHttpContextAccessor httpContextAccessor,
    IVariationContextAccessor variationContextAccessor) : IPublishedModelFactory, IAutoPublishedModelFactory
{
    public IPublishedModelFactory Inner => inner;

    public IPublishedElement CreateModel(IPublishedElement element)
    {
        EditModeRequest? editMode = EditModeRequest.Get(httpContextAccessor.HttpContext);
        if (editMode is not null && element is not MarkedPublishedContent and not MarkedPublishedElement)
        {
            if (element is IPublishedContent content)
            {
                // Only the edited document; other pages (navigation, pickers) render unmarked.
                if (content.Key == editMode.Session.DocumentKey)
                {
                    element = new MarkedPublishedContent(content, editMode.Markers, variationContextAccessor);
                }
            }
            else if (editMode.BlockKeys.Contains(element.Key))
            {
                element = new MarkedPublishedElement(element, editMode.Markers, variationContextAccessor);
            }
        }

        return inner.CreateModel(element);
    }

    public Type GetModelType(string? alias) => inner.GetModelType(alias);

    public Type MapModelType(Type type) => inner.MapModelType(type);

    public System.Collections.IList? CreateModelList(string? alias) => inner.CreateModelList(alias);

    // IAutoPublishedModelFactory (InMemoryAuto ModelsBuilder)
    public object SyncRoot => (inner as IAutoPublishedModelFactory)?.SyncRoot ?? this;

    public bool Enabled => (inner as IAutoPublishedModelFactory)?.Enabled ?? false;

    public void Reset() => (inner as IAutoPublishedModelFactory)?.Reset();
}
