import asyncio

from app.ws import background


def test_shutdown_waits_for_in_flight_database_work(monkeypatch):
    async def exercise():
        entered = asyncio.Event()
        release = asyncio.Event()
        finished = asyncio.Event()
        stopped = asyncio.Event()

        async def sweep():
            entered.set()
            await release.wait()
            finished.set()

        monkeypatch.setattr(background, "sweep_once", sweep)
        task = asyncio.create_task(background.run_sweeper(stopped))
        await entered.wait()
        stopped.set()
        await asyncio.sleep(0)
        assert not task.done()
        release.set()
        await asyncio.wait_for(task, 1)
        assert finished.is_set()

    asyncio.run(exercise())
