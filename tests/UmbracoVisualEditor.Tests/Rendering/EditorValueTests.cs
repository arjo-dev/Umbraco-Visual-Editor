using System.Text.Json;
using System.Text.Json.Nodes;
using UmbracoVisualEditor.Rendering;

namespace UmbracoVisualEditor.Tests.Rendering;

public class EditorValueTests
{
    private static object? Read(string json) => EditorValue.FromJson(JsonDocument.Parse(json).RootElement.Clone());

    [Fact]
    public void Booleans_AreBooleans()
    {
        // The True/False value editor reads anything that isn't a bool, int or string as false.
        Assert.Equal(true, Read("true"));
        Assert.Equal(false, Read("false"));
    }

    [Fact]
    public void Text_IsAString()
        => Assert.Equal("Hello", Read("\"Hello\""));

    [Fact]
    public void Objects_AreJsonNodes_AsTheManagementApiGivesThem()
    {
        Assert.IsType<JsonObject>(Read("""{"markup":"<p>Hi</p>","blocks":null}"""));
        Assert.IsType<JsonArray>(Read("""[{"key":"a"},{"key":"b"}]"""));
    }

    [Fact]
    public void MissingOrNull_IsNull()
    {
        Assert.Null(EditorValue.FromJson(default));
        Assert.Null(Read("null"));
    }
}
