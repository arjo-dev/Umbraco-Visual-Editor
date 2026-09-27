using Microsoft.Extensions.Logging;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Models.Editors;
using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Core.PropertyEditors;
using Umbraco.Cms.Core.PublishedCache;
using Umbraco.Cms.Core.Services;

namespace UmbracoVisualEditor.Rendering;

/// <summary>
/// Builds an in-memory <see cref="IPublishedContent"/> for a document: its draft, with properties replaced by the
/// session's unsaved editor values. Nothing is persisted.
/// </summary>
public sealed class OverlayContentBuilder(
    IPublishedContentCache contentCache,
    PropertyEditorCollection propertyEditors,
    IPublishedModelFactory modelFactory,
    IVariationContextAccessor variationContextAccessor,
    IContentTypeService contentTypeService,
    ILogger<OverlayContentBuilder> logger)
{
    public async Task<IPublishedContent?> BuildAsync(RenderSession session)
    {
        IPublishedContent? draft = await contentCache.GetByIdAsync(session.DocumentKey, preview: true);
        if (draft is null)
        {
            return null;
        }

        // Property type keys by alias, which some editors need to convert a value.
        IReadOnlyDictionary<string, Guid> propertyTypeKeys =
            contentTypeService.Get(draft.ContentType.Key)?.CompositionPropertyTypes
                .GroupBy(p => p.Alias, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().Key, StringComparer.OrdinalIgnoreCase)
            ?? new Dictionary<string, Guid>();

        var overrides = new List<IPublishedProperty>();
        foreach (IGrouping<string, RenderValue> group in session.Values.GroupBy(v => v.Alias, StringComparer.OrdinalIgnoreCase))
        {
            IPublishedPropertyType? propertyType = draft.ContentType.GetPropertyType(group.Key);
            if (propertyType is null)
            {
                continue;
            }

            var sources = new Dictionary<(string, string), object?>();
            foreach (RenderValue value in group)
            {
                // A value that can't be converted shows as saved rather than failing the whole page.
                try
                {
                    sources[(value.Culture ?? string.Empty, value.Segment ?? string.Empty)] =
                        ToStoredValue(propertyType, value, session.DocumentKey, propertyTypeKeys);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex, "Couldn't convert the unsaved value of {Alias}; rendering its saved value", value.Alias);
                }
            }

            if (sources.Count == 0)
            {
                continue;
            }

            overrides.Add(new OverlayPublishedProperty(
                propertyType,
                draft,
                draft.GetProperty(group.Key),
                variationContextAccessor,
                sources,
                session.Segment));
        }

        // Re-apply the ModelsBuilder model so strongly typed views (UmbracoViewPage<Home>) still bind.
        var overlay = new OverlayPublishedContent(draft, overrides, session.Variants ?? [], variationContextAccessor);
        return (IPublishedContent)modelFactory.CreateModel(overlay);
    }

    /// <summary>
    /// Converts an editor-format value to the stored format, as saving would, via the property editor's
    /// <see cref="IDataValueEditor.FromEditor"/>. The published value converters then take it from there.
    /// Without side effects (#34): uploads not saved yet are left out (<see cref="PendingUploads"/>), and there is no
    /// current value, which editors would otherwise tidy up (an upload field deletes a replaced file).
    /// </summary>
    private object? ToStoredValue(
        IPublishedPropertyType propertyType,
        RenderValue value,
        Guid documentKey,
        IReadOnlyDictionary<string, Guid> propertyTypeKeys)
    {
        if (!propertyEditors.TryGet(propertyType.EditorAlias, out IDataEditor? editor))
        {
            logger.LogWarning("No property editor {EditorAlias} for {Alias}", propertyType.EditorAlias, value.Alias);
            return null;
        }

        var configuration = propertyType.DataType.ConfigurationObject;
        IDataValueEditor valueEditor = editor.GetValueEditor(configuration);
        var data = new ContentPropertyData(EditorValue.FromJson(PendingUploads.Remove(value.Value)), configuration)
        {
            ContentKey = documentKey,
            // The Image Cropper refuses values without it.
            PropertyTypeKey = propertyTypeKeys.GetValueOrDefault(propertyType.Alias),
        };
        return valueEditor.FromEditor(data, currentValue: null);
    }
}
