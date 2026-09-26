using System.Text.Json;
using UmbracoVisualEditor.Markers;
using UmbracoVisualEditor.Rendering;

namespace UmbracoVisualEditor.Tests.Markers;

public class EditModeRequestTests
{
    private static readonly Guid Outer = Guid.Parse("11111111-1111-4111-8111-111111111111");
    private static readonly Guid Nested = Guid.Parse("22222222-2222-4222-8222-222222222222");
    private static readonly Guid Settings = Guid.Parse("33333333-3333-4333-8333-333333333333");
    private static readonly Guid Media = Guid.Parse("44444444-4444-4444-8444-444444444444");

    private static RenderValue Value(string alias, string json)
        => new(alias, null, null, JsonDocument.Parse(json).RootElement.Clone());

    private static RenderSession Session(params RenderValue[] values)
        => new(Guid.NewGuid(), Guid.NewGuid(), null, null, values, [], Guid.Empty);

    [Fact]
    public void BlockKeys_IncludesContentSettingsAndNestedBlocks()
    {
        var grid = Value("grid", $$"""
            {
              "layout": { "Umbraco.BlockGrid": [ { "contentKey": "{{Outer}}", "settingsKey": "{{Settings}}", "areas": [] } ] },
              "contentData": [
                {
                  "contentTypeKey": "00000000-0000-4000-8000-000000000001",
                  "key": "{{Outer}}",
                  "values": [
                    {
                      "alias": "innerBlocks",
                      "value": {
                        "layout": { "Umbraco.BlockList": [ { "contentKey": "{{Nested}}" } ] },
                        "contentData": [ { "contentTypeKey": "00000000-0000-4000-8000-000000000002", "key": "{{Nested}}", "values": [] } ],
                        "settingsData": []
                      }
                    }
                  ]
                }
              ],
              "settingsData": [ { "contentTypeKey": "00000000-0000-4000-8000-000000000003", "key": "{{Settings}}", "values": [] } ],
              "expose": []
            }
            """);

        var request = new EditModeRequest(Session(grid));

        Assert.Equal(new HashSet<Guid> { Outer, Nested, Settings }, request.BlockKeys.ToHashSet());
    }

    [Fact]
    public void BlockKeys_IgnoresKeysOutsideBlockData()
    {
        // Media picker values also have "key" fields, but they aren't blocks.
        var mediaPicker = Value("image", $$"""[ { "key": "{{Media}}", "mediaKey": "{{Media}}" } ]""");
        var text = Value("title", "\"Hello\"");

        var request = new EditModeRequest(Session(mediaPicker, text));

        Assert.Empty(request.BlockKeys);
    }

    [Fact]
    public void Get_ReturnsWhatWasSet_AndNullOtherwise()
    {
        var context = new Microsoft.AspNetCore.Http.DefaultHttpContext();
        Assert.Null(EditModeRequest.Get(context));
        Assert.Null(EditModeRequest.Get(null));

        var request = new EditModeRequest(Session());
        EditModeRequest.Set(context, request);

        Assert.Same(request, EditModeRequest.Get(context));
    }
}
