from http.server import BaseHTTPRequestHandler
from .handlers.followup import FollowupHandlerMixin
from .handlers.forum_reads import ForumReadsHandlerMixin
from .handlers.meeting_batch import MeetingBatchHandlerMixin

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
    MeetingBatchHandlerMixin,
    AccountsHandlerMixin,
    CollaborationHandlerMixin,
    OperationsHandlerMixin,
    SystemHandlerMixin,
    BaseHTTPRequestHandler,
):
    """Composed HTTP handler; domain behavior lives in focused mixins."""

    pass
