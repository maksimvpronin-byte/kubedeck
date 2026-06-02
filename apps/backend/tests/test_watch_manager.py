from __future__ import annotations

import io

from kubedeck_backend.api.watch_manager import ResourceWatchManager, build_watch_args, normalize_watch_namespace
from kubedeck_backend.kubectl.command import KubectlCommand


class FakeProcess:
    def __init__(self) -> None:
        self.pid = 4242
        self.stdout = io.StringIO('')
        self.stderr = io.StringIO('')
        self.returncode = None
        self.terminated = False
        self.killed = False

    def poll(self):
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = 0

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9

    def wait(self, timeout=None):
        if self.returncode is None:
            self.returncode = 0
        return self.returncode


def test_build_watch_args_namespace_modes():
    assert build_watch_args('pods', 'all') == ['get', 'pods', '-o', 'json', '--watch=true', '--output-watch-events=true', '-A']
    assert build_watch_args('pods', 'default') == ['get', 'pods', '-o', 'json', '--watch=true', '--output-watch-events=true', '-n', 'default']
    assert build_watch_args('nodes', '_cluster') == ['get', 'nodes', '-o', 'json', '--watch=true', '--output-watch-events=true']


def test_normalize_watch_namespace_defaults_to_all():
    assert normalize_watch_namespace(None) == 'all'
    assert normalize_watch_namespace('') == 'all'
    assert normalize_watch_namespace('default') == 'default'


def test_watch_manager_start_deduplicates_running_watch_and_stop_all():
    processes: list[FakeProcess] = []

    def fake_popen(*args, **kwargs):
        process = FakeProcess()
        processes.append(process)
        return process

    manager = ResourceWatchManager(popen_factory=fake_popen)
    command = KubectlCommand(
        cluster_id='cluster-a',
        kubeconfig_path=None,
        kubectl_path='kubectl',
        args=build_watch_args('pods', 'default'),
        timeout_seconds=0,
        max_output_bytes=0,
    )

    first = manager.start(command, 'pods', 'default')
    second = manager.start(command, 'pods', 'default')

    assert first['alreadyRunning'] is False
    assert second['alreadyRunning'] is True
    assert len(processes) == 1
    assert manager.status()['running'] == 1

    stopped = manager.stop_all()

    assert stopped['stopped'] == 1
    assert processes[0].terminated is True
    assert manager.status()['running'] == 0
