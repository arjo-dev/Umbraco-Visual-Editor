using Asp.Versioning;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Arjo.VisualEditor.Controllers
{
    [ApiVersion("1.0")]
    [ApiExplorerSettings(GroupName = "Arjo.VisualEditor")]
    public class ArjoVisualEditorApiController : ArjoVisualEditorApiControllerBase
    {
        [HttpGet("ping")]
        [ProducesResponseType<string>(StatusCodes.Status200OK)]
        public string Ping() => "Pong";
    }
}
