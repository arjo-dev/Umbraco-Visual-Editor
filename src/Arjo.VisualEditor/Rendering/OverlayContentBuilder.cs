using Microsoft.Extensions.Logging;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Models.Editors;
using Umbraco.Cms.Core.Models.PublishedContent;
using Umbraco.Cms.Core.PropertyEditors;
using Umbraco.Cms.Core.PublishedCache;

namespace Arjo.VisualEditor.Rendering;

/// <summary>
/// Builds an in-memory <see cref="IPublishedContent"/> for a document: its draft, with properties replaced by the
/// session's unsaved editor values. Nothing is persisted.
/// </summary>
public sealed class OverlayContentBuilder(
    IPublishedContentCache contentCache,
    PropertyEditorCollection propertyEditors,
    IPublishedModelFactory modelFactory,
    IVariationContextAccessor variationContextAccessor,
    ILogger<OverlayContentBuilder> logger)
{
    public async Task<IPublishedContent?> BuildAsync(RenderSession session)
    {
        IPublishedContent? draft = await contentCache.GetByIdAsync(session.DocumentKey, preview: true);
        if (draft is null)
        {
            return null;
        }

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
                sources[(value.Culture ?? string.Empty, value.Segment ?? string.Empty)] =
                    ToStoredValue(propertyType, value, session.DocumentKey);
            }

            overrides.Add(new OverlayPublishedProperty(propertyType, draft, draft.GetProperty(group.Key), variationContextAccessor, sources));
        }

        // Re-apply the ModelsBuilder model so strongly typed views (UmbracoViewPage<Home>) still bind.
        return (IPublishedContent)modelFactory.CreateModel(new OverlayPublishedContent(draft, overrides));
    }

    /// <summary>
    /// Converts an editor-format value to the stored format, exactly as saving would, via the property editor's
    /// <see cref="IDataValueEditor.FromEditor"/>. The published value converters then take it from there.
    /// </summary>
    private object? ToStoredValue(IPublishedPropertyType propertyType, RenderValue value, Guid documentKey)
    {
        if (!propertyEditors.TryGet(propertyType.EditorAlias, out IDataEditor? editor))
        {
            logger.LogWarning("No property editor {EditorAlias} for {Alias}", propertyType.EditorAlias, value.Alias);
            return null;
        }

        var configuration = propertyType.DataType.ConfigurationObject;
        IDataValueEditor valueEditor = editor.GetValueEditor(configuration);
        var data = new ContentPropertyData(value.Value, configuration) { ContentKey = documentKey };
        return valueEditor.FromEditor(data, currentValue: null);
    }
}
