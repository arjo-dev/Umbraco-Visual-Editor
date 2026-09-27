using System.Text.Json;
using Umbraco.Cms.Infrastructure.Serialization;

namespace UmbracoVisualEditor.Rendering;

/// <summary>
/// A workspace value as the Management API reads it, for <c>IDataValueEditor.FromEditor</c>. The API deserialises
/// values with Umbraco's <see cref="JsonObjectConverter"/>: a <c>bool</c>, <c>string</c>, number, list or JSON node
/// rather than a <see cref="JsonElement"/>, and value editors expect those. Given a <see cref="JsonElement"/>, the
/// True/False editor (among others that check a value's type) always read it as false.
/// </summary>
internal static class EditorValue
{
    private static readonly JsonSerializerOptions Options = new() { Converters = { new JsonObjectConverter() } };

    public static object? FromJson(JsonElement value)
        => value.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? null
            : JsonSerializer.Deserialize<object>(value.GetRawText(), Options);
}
