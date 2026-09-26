using UmbracoVisualEditor.Markers;

namespace UmbracoVisualEditor.Tests.Markers;

public class StegaTests
{
    // Built from code points: the characters themselves are invisible.
    private const char Delimiter = (char)0x2063;
    private static readonly char[] Digits = [(char)0x200B, (char)0x200C, (char)0x200D, (char)0x2060];

    private static int Decode(string encoded)
    {
        Assert.Equal(Delimiter, encoded[0]);
        Assert.Equal(Delimiter, encoded[^1]);
        return encoded[1..^1].Aggregate(0, (n, c) => (n * 4) + Array.IndexOf(Digits, c));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(255)]
    [InlineData(100_000)]
    public void Encode_RoundTrips(int id) => Assert.Equal(id, Decode(Stega.Encode(id)));

    [Fact]
    public void Encode_UsesOnlyInvisibleCharacters()
    {
        var encoded = Stega.Encode(12345);
        Assert.All(encoded, c => Assert.Contains(c, Digits.Append(Delimiter)));
    }

    [Fact]
    public void Encode_IsUniquePerId()
    {
        var encodings = Enumerable.Range(0, 5000).Select(Stega.Encode).ToList();
        Assert.Equal(encodings.Count, encodings.Distinct().Count());
    }

    [Fact]
    public void Encode_IsShortForTypicalPageSizes()
    {
        // Delimiters plus base-4 digits: ids up to 255 need at most 6 characters.
        Assert.True(Stega.Encode(255).Length <= 6);
    }
}
