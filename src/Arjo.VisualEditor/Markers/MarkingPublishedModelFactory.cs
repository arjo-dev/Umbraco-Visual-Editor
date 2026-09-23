using Arjo.VisualEditor.Rendering;
using Microsoft.AspNetCore.Http;
using Umbraco.Cms.Core.Models.PublishedContent;

namespace Arjo.VisualEditor.Markers;

/// <summary>
/// Decorates the site's <see cref="IPublishedModelFactory"/>. During edit-mode requests only, the edited document's
/// overlay (<see cref="OverlayPublishedContent"/>) and the block elements converted from its values (block converters
/// create elements through this factory) are wrapped so their properties emit markers, before the site's own
/// ModelsBuilder model is applied on top.
/// Anything else created during the request is left alone, in particular models Umbraco builds for its shared
/// published cache (e.g. the live page, loaded by navigation): marking those would leak markers to live visitors.
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
            if (element is OverlayPublishedContent overlay)
            {
                // Only our in-memory overlay of the edited document, never a cached published instance of it.
                element = new MarkedPublishedContent(overlay, editMode.Markers, variationContextAccessor);
            }
            else if (element is not IPublishedContent
                && MarkingScope.IsActive
                && editMode.BlockKeys.Contains(element.Key))
            {
                // A block converted from the overlay's (or a marked block's) values during this request.
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
