using System.Text;

namespace Arjo.VisualEditor.Markers;

/// <summary>
/// Encodes a marker id as invisible characters so it survives HTML encoding and can sit inside text or attribute
/// values: U+2063 (invisible separator), the id in base 4 using zero-width characters, then U+2063 again.
/// The canvas runtime finds, decodes and strips these (see Client/src/canvas/markers.ts).
/// </summary>
public static class Stega
{
    public const char Delimiter = '\u2063';

    private static readonly char[] Digits = ['\u200B', '\u200C', '\u200D', '\u2060'];

    public static string Encode(int id)
    {
        var sb = new StringBuilder().Append(Delimiter);
        var digits = new Stack<char>();
        do
        {
            digits.Push(Digits[id % 4]);
            id /= 4;
        }
        while (id > 0);

        return sb.Append(digits.ToArray()).Append(Delimiter).ToString();
    }
}
