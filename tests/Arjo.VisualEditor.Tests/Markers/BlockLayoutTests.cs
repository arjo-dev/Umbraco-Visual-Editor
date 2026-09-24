using System.Text.Json;
using Arjo.VisualEditor.Markers;
using Arjo.VisualEditor.Rendering;

namespace Arjo.VisualEditor.Tests.Markers;

public class BlockLayoutTests
{
    private static readonly Guid Document = Guid.Parse("00000000-0000-4000-8000-00000000d0c0");
    private static readonly Guid Row = Guid.Parse("11111111-1111-4111-8111-111111111111");
    private static readonly Guid Layout = Guid.Parse("22222222-2222-4222-8222-222222222222");
    private static readonly Guid Left = Guid.Parse("33333333-3333-4333-8333-333333333333");
    private static readonly Guid Right = Guid.Parse("44444444-4444-4444-8444-444444444444");
    private static readonly Guid LeftArea = Guid.Parse("55555555-5555-4555-8555-555555555555");
    private static readonly Guid RightArea = Guid.Parse("66666666-6666-4666-8666-666666666666");
    private static readonly Guid Nested = Guid.Parse("77777777-7777-4777-8777-777777777777");
    private static readonly Guid Settings = Guid.Parse("88888888-8888-4888-8888-888888888888");
    private static readonly Guid Hero = Guid.Parse("99999999-9999-4999-8999-999999999999");
    private static readonly Guid RteBlock = Guid.Parse("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    private static readonly Guid Danish = Guid.Parse("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    private static readonly Guid RowType = Guid.Parse("00000000-0000-4000-8000-000000000001");
    private static readonly Guid LayoutType = Guid.Parse("00000000-0000-4000-8000-000000000002");

    private static RenderValue Value(string alias, string? culture, string json)
        => new(alias, culture, null, JsonDocument.Parse(json).RootElement.Clone());

    // A grid: a full-width row, then a layout block with two areas; the left area's block has a nested Block List.
    private static readonly RenderValue Grid = Value("grid", null, $$"""
        {
          "layout": {
            "Umbraco.BlockGrid": [
              { "contentKey": "{{Row}}", "settingsKey": "{{Settings}}", "columnSpan": 12, "rowSpan": 1, "areas": [] },
              {
                "contentKey": "{{Layout}}", "settingsKey": null, "columnSpan": 12, "rowSpan": 2,
                "areas": [
                  { "key": "{{LeftArea}}", "items": [ { "contentKey": "{{Left}}", "columnSpan": 6, "rowSpan": 1, "areas": [] } ] },
                  { "key": "{{RightArea}}", "items": [ { "contentKey": "{{Right}}", "columnSpan": 6, "rowSpan": 1, "areas": [] } ] }
                ]
              }
            ]
          },
          "contentData": [
            { "key": "{{Row}}", "contentTypeKey": "{{RowType}}", "values": [] },
            { "key": "{{Layout}}", "contentTypeKey": "{{LayoutType}}", "values": [] },
            {
              "key": "{{Left}}", "contentTypeKey": "{{RowType}}",
              "values": [
                {
                  "alias": "items", "culture": null, "segment": null,
                  "value": {
                    "layout": { "Umbraco.BlockList": [ { "contentKey": "{{Nested}}", "settingsKey": null } ] },
                    "contentData": [ { "key": "{{Nested}}", "contentTypeKey": "{{RowType}}", "values": [] } ]
                  }
                }
              ]
            },
            { "key": "{{Right}}", "contentTypeKey": "{{RowType}}", "values": [] }
          ],
          "settingsData": [ { "key": "{{Settings}}", "contentTypeKey": "{{LayoutType}}", "values": [] } ]
        }
        """);

    private static IReadOnlyDictionary<Guid, BlockPlacement> Collect(string? culture, params RenderValue[] values)
        => BlockLayout.Collect(values, Document, culture);

    [Fact]
    public void GridItems_HavePropertyIndexSpansAndSettings()
    {
        var placements = Collect(null, Grid);

        BlockPlacement row = placements[Row];
        Assert.Equal("Umbraco.BlockGrid", row.EditorAlias);
        Assert.Equal("grid", row.PropertyAlias);
        Assert.Equal(Document, row.OwnerKey);
        Assert.False(row.OwnerIsBlock);
        Assert.Equal(0, row.Index);
        Assert.Equal(12, row.ColumnSpan);
        Assert.Equal(Settings, row.SettingsKey);
        Assert.Equal(RowType, row.ContentTypeKey);
        Assert.Empty(row.Path);

        Assert.Equal(1, placements[Layout].Index);
        Assert.Equal(2, placements[Layout].RowSpan);
        Assert.Null(placements[Layout].SettingsKey);
    }

    [Fact]
    public void GridAreaItems_HaveTheirAreaAndTheBlockAroundThem()
    {
        var placements = Collect(null, Grid);

        BlockPlacement right = placements[Right];
        Assert.Equal("grid", right.PropertyAlias);
        Assert.Equal(Document, right.OwnerKey);
        Assert.Equal(RightArea, right.AreaKey);
        Assert.Equal(Layout, right.AreaOwnerKey);
        Assert.Equal(0, right.Index);
        Assert.Equal(6, right.ColumnSpan);
        Assert.Equal([Layout], right.Path);
    }

    [Fact]
    public void NestedBlocks_BelongToTheirBlocksProperty_WithTheirPath()
    {
        BlockPlacement nested = Collect(null, Grid)[Nested];

        Assert.Equal("Umbraco.BlockList", nested.EditorAlias);
        Assert.Equal("items", nested.PropertyAlias);
        Assert.Equal(Left, nested.OwnerKey);
        Assert.True(nested.OwnerIsBlock);
        Assert.Null(nested.AreaKey);
        Assert.Null(nested.ColumnSpan);
        Assert.Equal([Layout, Left], nested.Path);
    }

    [Fact]
    public void SingleBlocksAndRichTextBlocks_AreIncluded()
    {
        var single = Value("hero", null, $$"""
            {
              "layout": { "Umbraco.SingleBlock": [ { "contentKey": "{{Hero}}", "settingsKey": null } ] },
              "contentData": [ { "key": "{{Hero}}", "contentTypeKey": "{{RowType}}", "values": [] } ]
            }
            """);
        var richText = Value("body", null, $$"""
            {
              "markup": "<p>Text</p><umb-rte-block data-content-key=\"{{RteBlock}}\"></umb-rte-block>",
              "blocks": {
                "layout": { "Umbraco.RichText": [ { "contentKey": "{{RteBlock}}", "settingsKey": null } ] },
                "contentData": [ { "key": "{{RteBlock}}", "contentTypeKey": "{{RowType}}", "values": [] } ]
              }
            }
            """);

        var placements = Collect(null, single, richText);

        Assert.Equal(("Umbraco.SingleBlock", "hero"), (placements[Hero].EditorAlias, placements[Hero].PropertyAlias));
        Assert.Equal(("Umbraco.RichText", "body"), (placements[RteBlock].EditorAlias, placements[RteBlock].PropertyAlias));
    }

    [Fact]
    public void OnlyTheRenderedCultureAndInvariantValues_AreRead()
    {
        var danish = Value("list", "da-DK", $$"""
            { "layout": { "Umbraco.BlockList": [ { "contentKey": "{{Danish}}" } ] }, "contentData": [] }
            """);
        var english = Value("list", "en-US", $$"""
            { "layout": { "Umbraco.BlockList": [ { "contentKey": "{{Hero}}" } ] }, "contentData": [] }
            """);

        var placements = Collect("en-US", danish, english, Grid);

        Assert.False(placements.ContainsKey(Danish));
        Assert.Equal("en-US", placements[Hero].PropertyCulture);
        Assert.True(placements.ContainsKey(Row));
    }

    [Fact]
    public void ValuesThatAreNotBlocks_AreIgnored()
    {
        var text = Value("title", null, "\"Hello\"");
        var picker = Value("links", null, """[ { "key": "x", "url": "/" } ]""");
        var unrelated = Value("data", null, """{ "layout": "wide", "contentData": 3 }""");

        Assert.Empty(Collect(null, text, picker, unrelated));
    }
}
