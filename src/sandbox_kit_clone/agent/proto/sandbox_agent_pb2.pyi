from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ExecRequest(_message.Message):
    __slots__ = ("command", "cwd", "env", "timeout_seconds", "request_id")
    class EnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    COMMAND_FIELD_NUMBER: _ClassVar[int]
    CWD_FIELD_NUMBER: _ClassVar[int]
    ENV_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_SECONDS_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    command: str
    cwd: str
    env: _containers.ScalarMap[str, str]
    timeout_seconds: int
    request_id: str
    def __init__(self, command: _Optional[str] = ..., cwd: _Optional[str] = ..., env: _Optional[_Mapping[str, str]] = ..., timeout_seconds: _Optional[int] = ..., request_id: _Optional[str] = ...) -> None: ...

class ExecEvent(_message.Message):
    __slots__ = ("output", "exit")
    OUTPUT_FIELD_NUMBER: _ClassVar[int]
    EXIT_FIELD_NUMBER: _ClassVar[int]
    output: Output
    exit: Exit
    def __init__(self, output: _Optional[_Union[Output, _Mapping]] = ..., exit: _Optional[_Union[Exit, _Mapping]] = ...) -> None: ...

class Output(_message.Message):
    __slots__ = ("stream", "data")
    class Stream(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        STDOUT: _ClassVar[Output.Stream]
        STDERR: _ClassVar[Output.Stream]
    STDOUT: Output.Stream
    STDERR: Output.Stream
    STREAM_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    stream: Output.Stream
    data: bytes
    def __init__(self, stream: _Optional[_Union[Output.Stream, str]] = ..., data: _Optional[bytes] = ...) -> None: ...

class Exit(_message.Message):
    __slots__ = ("exit_code", "timed_out", "duration_ms", "error")
    EXIT_CODE_FIELD_NUMBER: _ClassVar[int]
    TIMED_OUT_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    exit_code: int
    timed_out: bool
    duration_ms: int
    error: str
    def __init__(self, exit_code: _Optional[int] = ..., timed_out: _Optional[bool] = ..., duration_ms: _Optional[int] = ..., error: _Optional[str] = ...) -> None: ...

class HealthRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class HealthReply(_message.Message):
    __slots__ = ("version", "workspace_root", "uptime_ms", "running")
    VERSION_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ROOT_FIELD_NUMBER: _ClassVar[int]
    UPTIME_MS_FIELD_NUMBER: _ClassVar[int]
    RUNNING_FIELD_NUMBER: _ClassVar[int]
    version: str
    workspace_root: str
    uptime_ms: int
    running: int
    def __init__(self, version: _Optional[str] = ..., workspace_root: _Optional[str] = ..., uptime_ms: _Optional[int] = ..., running: _Optional[int] = ...) -> None: ...
