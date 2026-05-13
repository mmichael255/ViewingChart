from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.deps import get_current_user
from app.database.connection import get_db
from app.database.models import User, Watchlist, WatchlistItem


router = APIRouter(prefix="/watchlists", tags=["watchlists"])


class WatchlistResponse(BaseModel):
    id: int
    name: str
    is_default: bool


class WatchlistItemResponse(BaseModel):
    id: int
    sym: str
    asset_type: str
    position: int
    exchange: str | None = None
    source: str | None = None
    label: str | None = None
    sub: str | None = None


class CreateWatchlistRequest(BaseModel):
    name: str = Field(min_length=1, max_length=50)
    is_default: bool = False


class UpdateWatchlistRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    is_default: bool | None = None


class AddWatchlistItemRequest(BaseModel):
    sym: str = Field(min_length=1, max_length=20)
    asset_type: str = Field(pattern="^(crypto|stock)$")
    exchange: str | None = Field(default=None, max_length=20)
    source: str | None = Field(default=None, max_length=32)
    label: str | None = Field(default=None, max_length=64)
    sub: str | None = Field(default=None, max_length=128)


class ReorderWatchlistItemsRequest(BaseModel):
    item_ids: list[int] = Field(min_length=1)


class CopyWatchlistItemsRequest(BaseModel):
    from_watchlist_id: int
    item_ids: list[int] | None = None


def _get_watchlist_or_404(db: Session, *, user_id: int, watchlist_id: int) -> Watchlist:
    wl = db.query(Watchlist).filter(Watchlist.id == watchlist_id, Watchlist.user_id == user_id).first()
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return wl


def _unset_other_defaults(db: Session, *, user_id: int, keep_watchlist_id: int) -> None:
    db.query(Watchlist).filter(
        Watchlist.user_id == user_id,
        Watchlist.id != keep_watchlist_id,
        Watchlist.is_default == True,  # noqa: E712
    ).update({"is_default": False})


@router.get("", response_model=list[WatchlistResponse])
def list_watchlists(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wls = (
        db.query(Watchlist)
        .filter(Watchlist.user_id == current_user.id)
        .order_by(Watchlist.is_default.desc(), Watchlist.id.asc())
        .all()
    )
    return [WatchlistResponse(id=w.id, name=w.name, is_default=bool(w.is_default)) for w in wls]


@router.post("", response_model=WatchlistResponse, status_code=201)
def create_watchlist(
    payload: CreateWatchlistRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wl = Watchlist(user_id=current_user.id, name=payload.name.strip(), is_default=bool(payload.is_default))
    db.add(wl)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Watchlist name already exists") from None

    if wl.is_default:
        _unset_other_defaults(db, user_id=current_user.id, keep_watchlist_id=wl.id)

    db.commit()
    return WatchlistResponse(id=wl.id, name=wl.name, is_default=bool(wl.is_default))


@router.patch("/{watchlist_id}", response_model=WatchlistResponse)
def update_watchlist(
    watchlist_id: int,
    payload: UpdateWatchlistRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wl = _get_watchlist_or_404(db, user_id=current_user.id, watchlist_id=watchlist_id)

    if payload.name is not None:
        wl.name = payload.name.strip()
    if payload.is_default is not None:
        wl.is_default = bool(payload.is_default)
        if wl.is_default:
            _unset_other_defaults(db, user_id=current_user.id, keep_watchlist_id=wl.id)

    try:
        db.add(wl)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Watchlist name already exists") from None

    db.refresh(wl)
    return WatchlistResponse(id=wl.id, name=wl.name, is_default=bool(wl.is_default))


@router.delete("/{watchlist_id}", status_code=204)
def delete_watchlist(
    watchlist_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wl = _get_watchlist_or_404(db, user_id=current_user.id, watchlist_id=watchlist_id)
    if wl.is_default:
        raise HTTPException(status_code=409, detail="Default watchlist cannot be deleted")

    db.delete(wl)
    db.commit()
    return None


@router.get("/{watchlist_id}/items", response_model=list[WatchlistItemResponse])
def list_items(
    watchlist_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wl = _get_watchlist_or_404(db, user_id=current_user.id, watchlist_id=watchlist_id)
    items = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.watchlist_id == wl.id)
        .order_by(WatchlistItem.position.asc(), WatchlistItem.id.asc())
        .all()
    )
    return [
        WatchlistItemResponse(
            id=i.id,
            sym=i.symbol,
            asset_type=i.asset_type,
            position=int(i.position),
            exchange=i.exchange,
            source=i.source,
            label=i.label,
            sub=i.sub,
        )
        for i in items
    ]


@router.post("/{watchlist_id}/items", response_model=WatchlistItemResponse, status_code=201)
def add_item(
    watchlist_id: int,
    payload: AddWatchlistItemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wl = _get_watchlist_or_404(db, user_id=current_user.id, watchlist_id=watchlist_id)

    max_pos = (
        db.query(func.max(WatchlistItem.position))
        .filter(WatchlistItem.watchlist_id == wl.id)
        .scalar()
    )
    next_pos = int(max_pos) + 1 if max_pos is not None else 0

    item = WatchlistItem(
        watchlist_id=wl.id,
        position=next_pos,
        symbol=payload.sym.strip().upper(),
        asset_type=payload.asset_type,
        exchange=(payload.exchange.strip() if payload.exchange else "BINANCE"),
        source=payload.source,
        label=payload.label,
        sub=payload.sub,
    )
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Symbol already exists in watchlist") from None

    db.refresh(item)
    return WatchlistItemResponse(
        id=item.id,
        sym=item.symbol,
        asset_type=item.asset_type,
        position=int(item.position),
        exchange=item.exchange,
        source=item.source,
        label=item.label,
        sub=item.sub,
    )


@router.put("/{watchlist_id}/items/reorder", status_code=204)
def reorder_items(
    watchlist_id: int,
    payload: ReorderWatchlistItemsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wl = _get_watchlist_or_404(db, user_id=current_user.id, watchlist_id=watchlist_id)

    ids = payload.item_ids
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=400, detail="Duplicate item ids")

    items = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.watchlist_id == wl.id, WatchlistItem.id.in_(ids))
        .all()
    )
    if len(items) != len(ids):
        raise HTTPException(status_code=400, detail="Some items not found in this watchlist")

    by_id = {i.id: i for i in items}
    for pos, item_id in enumerate(ids):
        by_id[item_id].position = int(pos)

    db.commit()
    return None


@router.post("/{watchlist_id}/items/copy", status_code=204)
def copy_items_from_watchlist(
    watchlist_id: int,
    payload: CopyWatchlistItemsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    dst = _get_watchlist_or_404(db, user_id=current_user.id, watchlist_id=watchlist_id)
    src = _get_watchlist_or_404(db, user_id=current_user.id, watchlist_id=payload.from_watchlist_id)

    q = db.query(WatchlistItem).filter(WatchlistItem.watchlist_id == src.id)
    if payload.item_ids:
        q = q.filter(WatchlistItem.id.in_(payload.item_ids))
    src_items = q.order_by(WatchlistItem.position.asc(), WatchlistItem.id.asc()).all()
    if not src_items:
        return None

    max_pos = (
        db.query(func.max(WatchlistItem.position))
        .filter(WatchlistItem.watchlist_id == dst.id)
        .scalar()
    )
    next_pos = int(max_pos) + 1 if max_pos is not None else 0

    existing_keys = set(
        db.query(WatchlistItem.symbol, WatchlistItem.asset_type)
        .filter(WatchlistItem.watchlist_id == dst.id)
        .all()
    )

    created_any = False
    for si in src_items:
        key = (si.symbol, si.asset_type)
        if key in existing_keys:
            continue
        item = WatchlistItem(
            watchlist_id=dst.id,
            position=next_pos,
            symbol=si.symbol,
            asset_type=si.asset_type,
            exchange=si.exchange,
            source=si.source,
            label=si.label,
            sub=si.sub,
        )
        db.add(item)
        existing_keys.add(key)
        created_any = True
        next_pos += 1

    if created_any:
        db.commit()
    return None


@router.delete("/{watchlist_id}/items/{item_id}", status_code=204)
def delete_item(
    watchlist_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    wl = _get_watchlist_or_404(db, user_id=current_user.id, watchlist_id=watchlist_id)
    item = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.watchlist_id == wl.id, WatchlistItem.id == item_id)
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    db.delete(item)
    db.commit()
    return None

