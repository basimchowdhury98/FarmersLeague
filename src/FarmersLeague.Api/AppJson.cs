using System.Text.Json;

static class AppJson
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);
}
