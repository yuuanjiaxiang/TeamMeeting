from http.server import BaseHTTPRequestHandler
from .handlers.followup import FollowupHandlerMixin

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
    AccountsHandlerMixin,
    CollaborationHandlerMixin,
    OperationsHandlerMixin,
    SystemHandlerMixin,
    BaseHTTPRequestHandler,
):
    """Composed HTTP handler; domain behavior lives in focused mixins."""

    pass
