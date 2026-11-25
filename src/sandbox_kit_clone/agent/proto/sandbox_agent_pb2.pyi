from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SyncMessage(_message.Message):
    __slots__ = ("start", "data", "end", "delete")
    START_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    END_FIELD_NUMBER: _ClassVar[int]
    DELETE_FIELD_NUMBER: _ClassVar[int]
    start: FileStart
    data: bytes
    end: FileEnd
    delete: Delete
    def __init__(self, start: _Optional[_Union[FileStart, _Mapping]] = ..., data: _Optional[bytes] = ..., end: _Optional[_Union[FileEnd, _Mapping]] = ..., delete: _Optional[_Union[Delete, _Mapping]] = ...) -> None: ...

class FileStart(_message.Message):
    __slots__ = ("path", "size", "sha256")
    PATH_FIELD_NUMBER: _ClassVar[int]
    SIZE_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    path: str
    size: int
    sha256: str
    def __init__(self, path: _Optional[str] = ..., size: _Optional[int] = ..., sha256: _Optional[str] = ...) -> None: ...

class FileEnd(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class Delete(_message.Message):
    __slots__ = ("path",)
    PATH_FIELD_NUMBER: _ClassVar[int]
    path: str
    def __init__(self, path: _Optional[str] = ...) -> None: ...

class FileAck(_message.Message):
    __slots__ = ("path", "op", "ok", "sha256", "error")
    class Op(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        PUT: _ClassVar[FileAck.Op]
        DELETE: _ClassVar[FileAck.Op]
    PUT: FileAck.Op
    DELETE: FileAck.Op
    PATH_FIELD_NUMBER: _ClassVar[int]
    OP_FIELD_NUMBER: _ClassVar[int]
    OK_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    path: str
    op: FileAck.Op
    ok: bool
    sha256: str
    error: str
    def __init__(self, path: _Optional[str] = ..., op: _Optional[_Union[FileAck.Op, str]] = ..., ok: _Optional[bool] = ..., sha256: _Optional[str] = ..., error: _Optional[str] = ...) -> None: ...

class SyncReply(_message.Message):
    __slots__ = ("acks", "bytes_written", "duration_ms")
    ACKS_FIELD_NUMBER: _ClassVar[int]
    BYTES_WRITTEN_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    acks: _containers.RepeatedCompositeFieldContainer[FileAck]
    bytes_written: int
    duration_ms: int
    def __init__(self, acks: _Optional[_Iterable[_Union[FileAck, _Mapping]]] = ..., bytes_written: _Optional[int] = ..., duration_ms: _Optional[int] = ...) -> None: ...

class ListRequest(_message.Message):
    __slots__ = ("exclude_dirs", "with_sha256", "limit")
    EXCLUDE_DIRS_FIELD_NUMBER: _ClassVar[int]
    WITH_SHA256_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    exclude_dirs: _containers.RepeatedScalarFieldContainer[str]
    with_sha256: bool
    limit: int
    def __init__(self, exclude_dirs: _Optional[_Iterable[str]] = ..., with_sha256: _Optional[bool] = ..., limit: _Optional[int] = ...) -> None: ...

class FileEntry(_message.Message):
    __slots__ = ("path", "size", "sha256", "mtime_ns")
    PATH_FIELD_NUMBER: _ClassVar[int]
    SIZE_FIELD_NUMBER: _ClassVar[int]
    SHA256_FIELD_NUMBER: _ClassVar[int]
    MTIME_NS_FIELD_NUMBER: _ClassVar[int]
    path: str
    size: int
    sha256: str
    mtime_ns: int
    def __init__(self, path: _Optional[str] = ..., size: _Optional[int] = ..., sha256: _Optional[str] = ..., mtime_ns: _Optional[int] = ...) -> None: ...

class PullRequest(_message.Message):
    __slots__ = ("paths",)
    PATHS_FIELD_NUMBER: _ClassVar[int]
    paths: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, paths: _Optional[_Iterable[str]] = ...) -> None: ...

class PullEvent(_message.Message):
    __slots__ = ("start", "data", "end", "missing")
    START_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    END_FIELD_NUMBER: _ClassVar[int]
    MISSING_FIELD_NUMBER: _ClassVar[int]
    start: FileStart
    data: bytes
    end: FileEnd
    missing: Missing
    def __init__(self, start: _Optional[_Union[FileStart, _Mapping]] = ..., data: _Optional[bytes] = ..., end: _Optional[_Union[FileEnd, _Mapping]] = ..., missing: _Optional[_Union[Missing, _Mapping]] = ...) -> None: ...

class Missing(_message.Message):
    __slots__ = ("path", "error")
    PATH_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    path: str
    error: str
    def __init__(self, path: _Optional[str] = ..., error: _Optional[str] = ...) -> None: ...

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
