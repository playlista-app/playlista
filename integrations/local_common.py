import base64
import ctypes
import json
import sys


class UserError(Exception):
    pass


def protect(value, decrypt=False):
    """Windows DPAPI: ciphertext is bound to the current OS user, no local key file."""
    if sys.platform != 'win32':
        raise UserError('Remembering a connection is only supported on Windows. Connect for this session instead.')
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_char))]

    raw = base64.b64decode(value, validate=True) if decrypt else json.dumps(value).encode('utf-8')
    buffer = ctypes.create_string_buffer(raw)
    source = Blob(len(raw), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char)))
    target = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    operation = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    operation.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                          ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    operation.restype = wintypes.BOOL
    if not operation(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(target)):
        raise UserError('Windows could not unlock the saved connection. Reconnect this account.')
    try:
        result = ctypes.string_at(target.data, target.size)
        return json.loads(result.decode('utf-8')) if decrypt else base64.b64encode(result).decode('ascii')
    finally:
        kernel.LocalFree(ctypes.cast(target.data, ctypes.c_void_p))


