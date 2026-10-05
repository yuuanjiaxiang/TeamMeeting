from http.server import BaseHTTPRequestHandler
from .handlers.followup import FollowupHandlerMixin
from .handlers.forum_reads import ForumReadsHandlerMixin

from .handlers import (
    AccountsHandlerMixin,
    CollaborationHandlerMixin,
    OperationsHandlerMixin,
    RequestHandlerMixin,
    SystemHandlerMixin,
)


class Handler(
    RequestHandlerMixin,
    FollowupHandlerMixin,
    ForumReadsHandlerMixin,
    AccountsHandlerMixin,
    CollaborationHandlerMixin,
    OperationsHandlerMixin,
    SystemHandlerMixin,
    BaseHTTPRequestHandler,
):
    """Composed HTTP handler; domain behavior lives in focused mixins."""

    pass
