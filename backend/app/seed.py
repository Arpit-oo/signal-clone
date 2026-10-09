"""Demo data so the app is usable immediately.

    uv run python -m app.seed          # seed if the database is empty
    uv run python -m app.seed --reset  # wipe and reseed

Every account logs in with its phone number and the code 123456.
"""

import argparse
import asyncio
import io
import math
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from PIL import Image, ImageDraw
from sqlalchemy import func, select

from app.core.config import get_settings
from app.db.base import Base, utcnow
from app.db.session import SessionLocal, engine
from app.demo_avatars import avatar_url
from app.models import (
    Attachment,
    Contact,
    Conversation,
    ConversationMember,
    Message,
    MessageMention,
    MessageReceipt,
    Reaction,
    User,
)
from app.models.conversation import direct_identity_key, note_identity_key

settings = get_settings()

USERS = {
    "alex": ("+15550000001", "Alex Rivera", "alex", "Coffee first ☕", "A110"),
    "priya": ("+919876540102", "Priya Sharma", "priya", "Building things", "A150"),
    "marcus": ("+15550000003", "Marcus Chen", "marcus", "On the trail 🥾", "A130"),
    "sofia": ("+15550000004", "Sofia Rossi", "sofia", "Ciao!", "A190"),
    "liam": ("+15550000005", "Liam O'Connor", "liam", "", "A170"),
    "aisha": ("+15550000006", "Aisha Khan", "aisha", "Be kind", "A120"),
    "daniel": ("+15550000007", "Daniel Kim", "daniel", "Signal only", "A200"),
    "emma": ("+15550000008", "Emma Novak", "emma", "Design @ studio", "A160"),
    "rahul": ("+15550000009", "Rahul Mehta", "rahul", "", "A140"),
}


@dataclass
class Line:
    who: str
    text: str
    minutes_ago: float
    reply_to: int | None = None  # index into the script
    reactions: dict[str, str] = field(default_factory=dict)
    mentions: list[str] = field(default_factory=list)
    image: str | None = None  # name of a generated image
    system: dict | None = None


def L(who, text, minutes_ago, **kw) -> Line:  # noqa: N802 - short builder for readable scripts
    return Line(who, text, minutes_ago, **kw)


DAY = 24 * 60

DIRECT_CHATS: list[tuple[tuple[str, str], list[Line], dict]] = [
    (
        ("alex", "priya"),
        [
            L("priya", "Hey! Are we still on for the demo tomorrow?", 3 * DAY + 40),
            L("alex", "Yes! 10am works for me", 3 * DAY + 38),
            L("priya", "Perfect. I'll book the room", 3 * DAY + 37, reactions={"alex": "👍"}),
            L("alex", "Can you send me the latest deck?", 2 * DAY + 300),
            L("priya", "Sending it over tonight", 2 * DAY + 290),
            L(
                "priya",
                "Also, the client loved the new onboarding flow 🎉",
                1 * DAY + 120,
                reactions={"alex": "❤️"},
            ),
            L("alex", "That's amazing news!!", 1 * DAY + 118),
            L("alex", "We should celebrate", 1 * DAY + 118),
            L("priya", "Dinner on Friday?", 1 * DAY + 100),
            L("alex", "Friday works. Thai place on 5th?", 1 * DAY + 95, reply_to=8),
            L("priya", "Yes!! I'll reserve for 7:30", 1 * DAY + 90, reactions={"alex": "😂"}),
            L("alex", "Did you get a chance to review my PR?", 95),
            L("priya", "Looking at it now", 80),
            L("priya", "Left a couple of comments, mostly nits. Looks great overall", 42),
            L("alex", "Thanks! Fixing them now", 40, reply_to=13),
            L("priya", "See you at standup 👋", 12),
        ],
        {},
    ),
    (
        ("alex", "marcus"),
        [
            L("marcus", "Trail conditions look great this weekend", 2 * DAY + 60),
            L("alex", "Which route are you thinking?", 2 * DAY + 50),
            L("marcus", "Eagle Peak loop. About 9 miles", 2 * DAY + 45),
            L("alex", "I'm in", 2 * DAY + 44, reactions={"marcus": "🔥"}),
            L("marcus", "Picked up the new tent btw", 35),
            L("marcus", "It's ridiculously light", 34),
            L("marcus", "Want to test it out on Saturday?", 6),
        ],
        {"read_through": {"alex": 4}},  # the last three are unread for Alex
    ),
    (
        ("alex", "sofia"),
        [
            L("alex", "Ciao Sofia! How was Rome?", 5 * DAY),
            L("sofia", "Bellissimo 😍 I ate way too much pasta", 5 * DAY - 30),
            L("sofia", "Sending you some photos", 5 * DAY - 29, image="sunset"),
            L("alex", "Wow that view!", 5 * DAY - 20, reply_to=2, reactions={"sofia": "❤️"}),
            L("alex", "We need to plan a trip together", 4 * DAY),
        ],
        # Sofia has been offline since Alex's last message: one grey tick.
        {"read_through": {"sofia": 4}, "offline": ["sofia"]},
    ),
    (
        ("alex", "liam"),
        [
            L("liam", "Did you watch the match last night?", 8 * 60),
            L("alex", "Unbelievable ending", 7 * 60 + 50),
            L("liam", "That last-minute goal 🤯", 7 * 60 + 45),
            L("alex", "Rematch at the pub next week?", 7 * 60 + 30),
            L("liam", "Obviously", 7 * 60 + 20, reactions={"alex": "😂"}),
        ],
        {"pin_for": ["alex"]},
    ),
    (
        ("alex", "aisha"),
        [
            L("aisha", "Hi Alex, quick question about the volunteer schedule", 2 * DAY + 600),
            L("alex", "Sure, what's up?", 2 * DAY + 590),
            L("aisha", "Can you swap Saturday for Sunday?", 2 * DAY + 585),
            L("alex", "Yes that's fine", 2 * DAY + 560),
            L("aisha", "Thank you so much 🙏", 2 * DAY + 555),
        ],
        {},
    ),
    (
        ("alex", "daniel"),
        [
            L("daniel", "Welcome to Signal!", 9 * DAY),
            L("alex", "Thanks Daniel, finally made the switch", 9 * DAY - 10),
        ],
        {"archive_for": ["alex"]},
    ),
    (
        ("priya", "emma"),
        [
            L("emma", "Mockups are ready for review", 3 * 60),
            L("priya", "On it!", 2 * 60 + 50),
        ],
        {},
    ),
]

GROUPS = [
    {
        "name": "Weekend Hikers",
        "description": "Trails, gear and bad trail mix.",
        "color": "A130",
        "admin": "alex",
        "members": ["priya", "marcus", "sofia", "liam"],
        "created_minutes_ago": 6 * DAY,
        "script": [
            L("marcus", "Who's in for Saturday?", 1 * DAY + 200),
            L("sofia", "Me!", 1 * DAY + 195),
            L("priya", "Count me in 🙋‍♀️", 1 * DAY + 190),
            L("liam", "I'll bring snacks", 1 * DAY + 180, reactions={"marcus": "🙏", "alex": "👍"}),
            L("alex", "Meet at the trailhead at 8?", 1 * DAY + 170),
            L("marcus", "8 is perfect", 1 * DAY + 160, reply_to=4),
            L("sofia", "Here's the view from last time", 1 * DAY + 100, image="mountain"),
            L("priya", "Gorgeous!!", 1 * DAY + 95, reactions={"sofia": "❤️", "alex": "❤️"}),
            L("marcus", "@Alex Rivera can you bring the first aid kit?", 90, mentions=["alex"]),
            L("liam", "Weather says sunny all day ☀️", 30),
        ],
        "read_through": {"alex": 8},
    },
    {
        "name": "Design Team",
        "description": "Weekly design sync and critiques.",
        "color": "A160",
        "admin": "priya",
        "members": ["alex", "emma", "daniel", "rahul"],
        "created_minutes_ago": 4 * DAY,
        "disappearing_seconds": 7 * 24 * 3600,
        "script": [
            L("priya", "Reminder: crit at 3pm today", 5 * 60),
            L("emma", "I'll present the new icon set", 4 * 60 + 50),
            L("rahul", "Can't wait to see it", 4 * 60 + 45),
            L("daniel", "Running 5 min late, start without me", 3 * 60 + 2),
            L("emma", "Slides are in the shared folder", 2 * 60, reactions={"priya": "👍"}),
        ],
        "read_through": {"alex": "all"},
    },
    {
        "name": "Book Club 📚",
        "description": None,
        "color": "A190",
        "admin": "sofia",
        "members": ["aisha", "emma", "rahul"],
        "created_minutes_ago": 10 * DAY,
        "script": [
            L("sofia", "Next pick: Piranesi?", 2 * DAY),
            L("aisha", "Yes please", 2 * DAY - 20),
            L("emma", "Already started it 👀", 2 * DAY - 15),
        ],
        "read_through": {},
    },
]

NOTES = {
    "alex": ["Grocery list: oat milk, eggs, basil", "Wifi password for the cabin: trailmix2024"],
}


def _make_image(kind: str) -> bytes:
    """Draw a simple landscape so the timeline has real image attachments."""
    w, h = 1200, 800
    img = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(img)
    top, bottom = (
        ((255, 126, 95), (254, 180, 123)) if kind == "sunset" else ((86, 152, 214), (198, 226, 245))
    )
    for y in range(h):
        t = y / h
        draw.line(
            [(0, y), (w, y)], fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        )
    if kind == "sunset":
        draw.ellipse([w // 2 - 120, h // 2 - 40, w // 2 + 120, h // 2 + 200], fill=(255, 220, 120))
        draw.rectangle([0, int(h * 0.62), w, h], fill=(40, 60, 110))
    else:
        for i, (peak, shade) in enumerate([(0.30, (70, 90, 110)), (0.45, (50, 70, 85))]):
            points = [(0, h)]
            for x in range(0, w + 1, 40):
                y = h * (peak + 0.18 * math.sin(x / (180 + i * 60) + i) + 0.08 * math.sin(x / 60))
                points.append((x, y + 120))
            points.append((w, h))
            draw.polygon(points, fill=shade)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def _store_image(kind: str) -> tuple[str, int]:
    data = _make_image(kind)
    key = f"attachments/seed-{kind}-{secrets.token_hex(6)}.jpg"
    path = settings.upload_dir / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return key, len(data)


async def _write_script(
    db,
    conv: Conversation,
    users: dict[str, User],
    member_keys: list[str],
    script: list[Line],
    now: datetime,
    read_through: dict[str, int | str],
    offline: set[str],
) -> None:
    created: list[Message] = []
    for line in script:
        sender = users[line.who]
        at = now - timedelta(minutes=line.minutes_ago)
        msg = Message(
            conversation_id=conv.id,
            sender_id=sender.id,
            client_id=f"seed-{secrets.token_hex(10)}",
            body=line.text,
            created_at=at,
            reply_to_id=created[line.reply_to].id if line.reply_to is not None else None,
            expires_in_seconds=conv.disappearing_seconds,
        )
        db.add(msg)
        await db.flush()
        created.append(msg)

        if line.image:
            key, size = _store_image(line.image)
            db.add(
                Attachment(
                    message_id=msg.id,
                    uploader_id=sender.id,
                    kind="image",
                    file_name=f"{line.image}.jpg",
                    mime_type="image/jpeg",
                    size_bytes=size,
                    width=1200,
                    height=800,
                    storage_key=key,
                    created_at=at,
                )
            )
        for who, emoji in line.reactions.items():
            db.add(Reaction(message_id=msg.id, user_id=users[who].id, emoji=emoji, created_at=at))
        for who in line.mentions:
            db.add(MessageMention(message_id=msg.id, user_id=users[who].id))

        for key in member_keys:
            if key == line.who:
                continue
            limit = read_through.get(key, "all")
            index = len(created) - 1
            is_read = limit == "all" or index < int(limit)
            delivered = key not in offline or is_read
            db.add(
                MessageReceipt(
                    message_id=msg.id,
                    user_id=users[key].id,
                    delivered_at=at + timedelta(seconds=2) if delivered else None,
                    read_at=at + timedelta(minutes=1) if is_read else None,
                )
            )
            if is_read and conv.disappearing_seconds and msg.expires_at is None:
                msg.expires_at = at + timedelta(minutes=1, seconds=conv.disappearing_seconds)

    # Each member's read pointer follows their read_through setting; senders have read their own.
    members = {
        m.user_id: m
        for m in await db.scalars(
            select(ConversationMember).where(ConversationMember.conversation_id == conv.id)
        )
    }
    for key in member_keys:
        limit = read_through.get(key, "all")
        upto = len(created) if limit == "all" else int(limit)
        own = [i for i, line in enumerate(script) if line.who == key]
        last_index = max([upto - 1, *own]) if (upto or own) else -1
        if last_index >= 0:
            members[users[key].id].last_read_message_id = created[last_index].id
    if created:
        conv.last_activity_at = created[-1].created_at


async def seed(db) -> None:
    now = utcnow()
    users: dict[str, User] = {}
    for key, (phone, name, username, about, color) in USERS.items():
        u = User(
            phone=phone,
            display_name=name,
            username=username,
            about=about,
            avatar_color=color,
            avatar_url=avatar_url(key),
            created_at=now - timedelta(days=30),
            last_seen_at=now - timedelta(minutes=5 + 7 * len(users)),
        )
        db.add(u)
        users[key] = u
    await db.flush()

    # Alex's address book holds everyone; others know a few people.
    for key in USERS:
        if key != "alex":
            db.add(Contact(owner_id=users["alex"].id, contact_id=users[key].id))
    for a, b in [
        ("priya", "alex"),
        ("priya", "emma"),
        ("marcus", "alex"),
        ("sofia", "alex"),
        ("liam", "alex"),
        ("aisha", "alex"),
        ("daniel", "alex"),
        ("emma", "priya"),
    ]:
        db.add(Contact(owner_id=users[a].id, contact_id=users[b].id))

    for key, user in users.items():
        conv = Conversation(
            type="note_to_self",
            identity_key=note_identity_key(user.id),
            created_by=user.id,
            avatar_color=user.avatar_color,
            created_at=now - timedelta(days=30),
            last_activity_at=now - timedelta(days=30),
        )
        conv.members.append(
            ConversationMember(user_id=user.id, role="admin", joined_at=now - timedelta(days=30))
        )
        db.add(conv)
        await db.flush()
        script = [L(key, text, 3 * DAY - i * 30) for i, text in enumerate(NOTES.get(key, []))]
        await _write_script(db, conv, users, [key], script, now, {}, set())

    for (a, b), script, opts in DIRECT_CHATS:
        start = now - timedelta(minutes=max(line.minutes_ago for line in script) + 5)
        conv = Conversation(
            type="direct",
            identity_key=direct_identity_key(users[a].id, users[b].id),
            created_by=users[a].id,
            created_at=start,
        )
        conv.members.extend(
            ConversationMember(
                user_id=users[k].id,
                joined_at=start,
                is_pinned=k in opts.get("pin_for", []),
                pinned_at=now if k in opts.get("pin_for", []) else None,
                is_archived=k in opts.get("archive_for", []),
            )
            for k in (a, b)
        )
        db.add(conv)
        await db.flush()
        await _write_script(
            db,
            conv,
            users,
            [a, b],
            script,
            now,
            opts.get("read_through", {}),
            set(opts.get("offline", [])),
        )

    for spec in GROUPS:
        start = now - timedelta(minutes=spec["created_minutes_ago"])
        conv = Conversation(
            type="group",
            name=spec["name"],
            description=spec["description"],
            avatar_color=spec["color"],
            created_by=users[spec["admin"]].id,
            disappearing_seconds=spec.get("disappearing_seconds"),
            created_at=start,
        )
        keys = [spec["admin"], *spec["members"]]
        conv.members.extend(
            ConversationMember(
                user_id=users[k].id,
                role="admin" if k == spec["admin"] else "member",
                joined_at=start,
            )
            for k in keys
        )
        db.add(conv)
        await db.flush()
        db.add(
            Message(
                conversation_id=conv.id,
                sender_id=users[spec["admin"]].id,
                type="system",
                meta={"event": "group_created", "name": spec["name"]},
                created_at=start,
            )
        )
        if spec.get("disappearing_seconds"):
            db.add(
                Message(
                    conversation_id=conv.id,
                    sender_id=users[spec["admin"]].id,
                    type="system",
                    meta={"event": "timer_changed", "seconds": spec["disappearing_seconds"]},
                    created_at=start + timedelta(seconds=1),
                )
            )
        await _write_script(db, conv, users, keys, spec["script"], now, spec["read_through"], set())

    await db.commit()


async def seed_if_empty() -> bool:
    async with SessionLocal() as db:
        if await db.scalar(select(func.count(User.id))):
            return False
        await seed(db)
        return True


async def reset_and_seed() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    async with SessionLocal() as db:
        await seed(db)


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--reset", action="store_true", help="drop all data and reseed")
    args = parser.parse_args()
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    if args.reset:
        asyncio.run(reset_and_seed())
        print("Database reset and seeded.")
    else:
        from app.db.migrations import migrate_database

        migrate_database()
        print("Seeded." if asyncio.run(seed_if_empty()) else "Database already has data; skipped.")


if __name__ == "__main__":
    main()
