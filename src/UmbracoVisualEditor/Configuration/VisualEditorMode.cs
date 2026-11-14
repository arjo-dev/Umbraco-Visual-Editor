using System.Text.Json.Serialization;

namespace UmbracoVisualEditor.Configuration;

/// <summary>
/// How the Visual editor edits what's on the page (<c>VisualEditor:EditorMode</c>). Set site-wide in appsettings.
/// </summary>
/// <remarks>
/// Serialized by name (<c>"SidePanel"</c>, <c>"Overlay"</c>), so the backoffice API and its generated client get a
/// string union rather than numbers, whatever JSON options the endpoint uses.
/// </remarks>
[JsonConverter(typeof(JsonStringEnumConverter<VisualEditorMode>))]
public enum VisualEditorMode
{
    /// <summary>
    /// The default: a side panel beside the page edits the selection and the page settings, text and rich text can be
    /// edited on the page (<see cref="VisualEditorOptions.EnablePropertyLevelEditing"/>), and the content tree is hidden
    /// while the Visual editor shows.
    /// </summary>
    SidePanel = 0,

    /// <summary>
    /// No side panel: clicking a block opens Umbraco's own block overlay, the same one the Content tab opens, for nested
    /// blocks too. Nothing is edited on the page itself, and the content tree stays visible. Document properties outside
    /// blocks are edited on the Content tab.
    /// </summary>
    Overlay = 1,
}
