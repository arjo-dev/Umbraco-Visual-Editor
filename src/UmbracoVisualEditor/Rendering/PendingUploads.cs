using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace UmbracoVisualEditor.Rendering;

/// <summary>
/// Rendering must never change anything (#34), but converting a value the way saving does
/// (<c>IDataValueEditor.FromEditor</c>) acts on files uploaded and not yet saved:
/// <list type="bullet">
/// <item>Upload field and Image Cropper values with a <c>temporaryFileId</c>: the file is moved into the media file
/// system and the temporary file deleted, so the real save would find it gone.</item>
/// <item>Rich text images pasted in (<c>&lt;img data-tmpimg="..."&gt;</c>): each is created as a media item, and the
/// Visual editor renders on every change.</item>
/// </list>
/// Before converting, these references are taken out, wherever they are (nested in blocks too). The page then shows
/// what the editor has (the image's <c>src</c>), and saving still finds the files.
/// </summary>
internal static partial class PendingUploads
{
    private const string TemporaryFileProperty = "temporaryFileId";
    private const string PastedImageAttribute = "data-tmpimg";

    [GeneratedRegex("""\s+data-tmpimg\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""", RegexOptions.IgnoreCase)]
    private static partial Regex PastedImage();

    /// <summary><paramref name="value"/> without references to uploads that aren't saved yet.</summary>
    public static JsonElement Remove(JsonElement value)
    {
        var raw = value.GetRawText();
        if (!raw.Contains(TemporaryFileProperty, StringComparison.OrdinalIgnoreCase)
            && !raw.Contains(PastedImageAttribute, StringComparison.OrdinalIgnoreCase))
        {
            return value;
        }

        JsonNode? node = JsonNode.Parse(raw);
        node = Clean(node) ?? node;
        return JsonSerializer.SerializeToElement(node);
    }

    /// <summary>Cleans objects and arrays in place; returns a replacement for a string that changes, else null.</summary>
    private static JsonNode? Clean(JsonNode? node)
    {
        switch (node)
        {
            case JsonObject obj:
                foreach (var name in obj.Select(p => p.Key).ToList())
                {
                    if (string.Equals(name, TemporaryFileProperty, StringComparison.OrdinalIgnoreCase))
                    {
                        obj[name] = null;
                    }
                    else if (Clean(obj[name]) is { } replacement)
                    {
                        obj[name] = replacement;
                    }
                }

                return null;

            case JsonArray array:
                for (var i = 0; i < array.Count; i++)
                {
                    if (Clean(array[i]) is { } replacement)
                    {
                        array[i] = replacement;
                    }
                }

                return null;

            case JsonValue value when value.GetValueKind() == JsonValueKind.String
                                      && value.GetValue<string>() is var text
                                      && text.Contains(PastedImageAttribute, StringComparison.OrdinalIgnoreCase):
                return JsonValue.Create(PastedImage().Replace(text, string.Empty));

            default:
                return null;
        }
    }
}
