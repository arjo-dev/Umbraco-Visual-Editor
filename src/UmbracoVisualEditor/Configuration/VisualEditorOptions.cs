using Microsoft.Extensions.Options;

namespace UmbracoVisualEditor.Configuration;

/// <summary>
/// The Visual editor's settings, from the <c>VisualEditor</c> section of appsettings (#32; schema:
/// <c>appsettings-schema.UmbracoVisualEditor.json</c>). Which tab a document opens on is a per-user choice (#48).
/// </summary>
public sealed class VisualEditorOptions
{
    public const string SectionName = "VisualEditor";

    /// <summary>Whether the Visual editor is offered at all. Default: true.</summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Document type aliases to offer it for; empty (the default) means every document type with a template.
    /// </summary>
    public string[] AllowedDocumentTypes { get; set; } = [];

    /// <summary>Document type aliases never to offer it for (applied after <see cref="AllowedDocumentTypes"/>).</summary>
    public string[] ExcludedDocumentTypes { get; set; } = [];

    /// <summary>
    /// Whether text and rich text can be edited on the page itself. When false, double-clicking them (or Enter) opens
    /// them in the side panel instead; blocks can still be selected, moved, added and deleted. Default: true.
    /// </summary>
    public bool EnablePropertyLevelEditing { get; set; } = true;

    /// <summary>Whether the Visual editor is offered for documents of this type.</summary>
    public bool IsEnabledFor(string documentTypeAlias)
        => Enabled
           && (AllowedDocumentTypes.Length == 0 || AllowedDocumentTypes.Contains(documentTypeAlias, StringComparer.OrdinalIgnoreCase))
           && !ExcludedDocumentTypes.Contains(documentTypeAlias, StringComparer.OrdinalIgnoreCase);
}

/// <summary>Checks the <c>VisualEditor</c> settings at startup: aliases must be given, and not both allowed and excluded.</summary>
internal sealed class VisualEditorOptionsValidator : IValidateOptions<VisualEditorOptions>
{
    public ValidateOptionsResult Validate(string? name, VisualEditorOptions options)
    {
        var failures = new List<string>();
        if (options.AllowedDocumentTypes.Any(string.IsNullOrWhiteSpace))
        {
            failures.Add($"{VisualEditorOptions.SectionName}:{nameof(VisualEditorOptions.AllowedDocumentTypes)} has an empty alias.");
        }

        if (options.ExcludedDocumentTypes.Any(string.IsNullOrWhiteSpace))
        {
            failures.Add($"{VisualEditorOptions.SectionName}:{nameof(VisualEditorOptions.ExcludedDocumentTypes)} has an empty alias.");
        }

        var both = options.AllowedDocumentTypes
            .Intersect(options.ExcludedDocumentTypes, StringComparer.OrdinalIgnoreCase)
            .Where(alias => !string.IsNullOrWhiteSpace(alias))
            .ToArray();
        if (both.Length > 0)
        {
            failures.Add(
                $"{VisualEditorOptions.SectionName}: document types both allowed and excluded: {string.Join(", ", both)}.");
        }

        return failures.Count > 0 ? ValidateOptionsResult.Fail(failures) : ValidateOptionsResult.Success;
    }
}
