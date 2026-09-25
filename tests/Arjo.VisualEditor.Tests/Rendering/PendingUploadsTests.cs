using System.Text.Json;
using Arjo.VisualEditor.Rendering;

namespace Arjo.VisualEditor.Tests.Rendering;

public class PendingUploadsTests
{
    private static JsonElement Json(string json) => JsonDocument.Parse(json).RootElement.Clone();

    [Fact]
    public void LeavesValuesWithoutUploadsAlone()
    {
        JsonElement value = Json("""{"markup":"<p>Hi</p>","blocks":null}""");
        Assert.Equal(value.GetRawText(), PendingUploads.Remove(value).GetRawText());
    }

    [Fact]
    public void ClearsTheTemporaryFileOfAnUpload_KeepingWhatTheEditorShows()
    {
        JsonElement result = PendingUploads.Remove(Json("""{"src":"blob:https://site/abc","temporaryFileId":"4a0b1d5e-8c0e-4f4a-9d7b-2d7f4c1b8e11"}"""));
        Assert.Equal(JsonValueKind.Null, result.GetProperty("temporaryFileId").ValueKind);
        Assert.Equal("blob:https://site/abc", result.GetProperty("src").GetString());
    }

    [Fact]
    public void TakesPastedImagesOutOfRichText()
    {
        JsonElement result = PendingUploads.Remove(Json(
            """{"markup":"<p><img src=\"blob:x\" data-tmpimg=\"4a0b1d5e-8c0e-4f4a-9d7b-2d7f4c1b8e11\" alt=\"A\"></p>"}"""));
        Assert.Equal("<p><img src=\"blob:x\" alt=\"A\"></p>", result.GetProperty("markup").GetString());
    }

    [Fact]
    public void FindsThemInsideBlocks()
    {
        JsonElement result = PendingUploads.Remove(Json("""
            {
              "layout": {},
              "contentData": [{
                "key": "b1",
                "values": [
                  { "alias": "image", "value": { "src": "", "temporaryFileId": "4a0b1d5e-8c0e-4f4a-9d7b-2d7f4c1b8e11" } },
                  { "alias": "text", "value": { "markup": "<img data-tmpimg='x' src='y'>" } }
                ]
              }]
            }
            """));
        JsonElement values = result.GetProperty("contentData")[0].GetProperty("values");
        Assert.Equal(JsonValueKind.Null, values[0].GetProperty("value").GetProperty("temporaryFileId").ValueKind);
        Assert.Equal("<img src='y'>", values[1].GetProperty("value").GetProperty("markup").GetString());
    }
}
