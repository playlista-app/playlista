# Playlista text format, version 2

This document defines the `.lista` format. It is plain text with its own small grammar; it is not YAML, JSON, or a programming language. A parser should reject invalid syntax, and a linter should report invalid playlist relationships.

## File shape

A file is UTF-8 text with this layout:

```text
version: 2
playlist: 90s Punk
parent: Punk
description: My favourite punk songs from the 90s
tags: [punk, emo]
created: 2026-10-26T12:34:56.789Z
updated: 2026-10-26T12:34:56.789Z
---
Sum 41 > In Too Deep
blink-182 > All The Small Things* > [banger, quiz]
The Anthem > ISRC: USSM10209827
```

The header ends at a line containing `---`. Its first non-blank, non-comment line must declare `version: 2`. Every file must contain one non-empty `playlist:` field and one `created:` and `updated:` timestamp. `parent:`, `description:`, and `tags:` are optional and may appear at most once. Unknown or duplicate header fields are errors. If present, `description:` must be non-empty.

Header field names and selector labels are case-insensitive. Playlist names are unique case-insensitively within a collection; `parent` resolves a name using the same rule. Names and descriptions preserve their written spelling. Timestamps use canonical UTC ISO format with millisecond precision, for example `2026-10-26T12:34:56.789Z`. `updated` cannot be earlier than `created`.

## Parent playlists and displayed songs

`parent` names the playlist directly above this playlist in the library tree. It points upward: a playlist does not copy songs from its parent. When viewing a playlist, the app shows that playlist's own track lines first, followed by songs from its descendants in tree order. Siblings are shown alphabetically; each descendant's own songs precede its children. A leaf playlist therefore shows only its own songs. Descriptions and playlist tags are local to their file and do not inherit.

A reference to a missing playlist, a duplicate name, or a parent cycle is a validation error. For example, if `90s Punk` has `parent: Punk`, viewing `Punk` includes songs owned by `90s Punk`; viewing `90s Punk` does not include songs owned by `Punk`.

## Track lines

Every non-blank, non-comment line after `---` is one track query. A query is made of non-empty parts separated by `>` characters outside quoted values and tag lists. Spaces around separators are ignored. Empty parts are syntax errors.

The common shorthand is:

```text
Artist > Title
Title
Artist > Title > ISRC: identifier
Title > ISRC: identifier
Artist > Title > [tag, tag]
```

One unlabelled text part means a title search. Two unlabelled text parts mean artist then title. Use explicit labels when you want an artist-only search or when a query would otherwise be ambiguous:

```text
artist: Sum 41
title: In Too Deep
artist: Sum 41 > title: In Too Deep > isrc: USSM10209827
isrc: USSM10209827
```

`artist:`, `title:`, and `isrc:` may be combined in any order, with at most one of each. Do not mix labelled `artist:`/`title:` parts with unlabelled text parts. Every query must specify at least one of artist, title, or ISRC. If multiple selectors are present, all must match the same track.

An optional tag list is a final `>` part written in square brackets. Tag entries are comma-separated and must be non-empty; a tag containing a comma, `>`, `[` or `]` must be double-quoted. A tag list may appear at most once and must contain at least one tag. Tag identity is case-insensitive, and duplicate tags are errors; spelling is preserved. Tags label the query; they do not constrain the search. Playlist tags use the same list syntax in the header.

`artist` and `title` values are case-insensitive glob patterns matched against the complete field: `*` matches zero or more characters and `?` matches one character. With no wildcard, the value must match the whole field exactly. All other characters match themselves. `isrc` is an exact identifier and does not accept wildcards.

## Text and comments

Values may be plain text or double-quoted text. Use double quotes when a value contains `>` or for a tag containing a comma, `[` or `]`. A quoted value must be quoted in full. Inside quotes, `\\` represents a backslash and `\"` represents a double quote; other escape sequences are invalid. Quoting does not change wildcard behavior.

Blank lines are ignored. A line whose first non-space character is `#` is a comment. Inline comments are not supported. Each header field, tag list, and track query occupies one line.

For example, a title containing `>` can be written as:

```text
artist: AC/DC > title: "Live > Loud"
```

## Collections and errors

A collection is all `.lista` files under a chosen directory, searched recursively. Filenames and subfolders have no semantic meaning. Playlist names, rather than file paths, identify playlists and `parent` relationships. Duplicate playlist names, missing parents, and parent cycles are validation errors. A cycle diagnostic should show the full loop, such as `Playlist A -> Playlist B -> Playlist A`.

Track searches may resolve to no tracks or multiple tracks; that is a resolution/export concern rather than a syntax error. Track lines remain ordered, and displaying descendants does not implicitly deduplicate them. The local editor updates `updated` when it adds, removes, or reorders a track; `created` is preserved.

Version 1 files used `extends` with the opposite inheritance direction and did not require timestamps. They must be migrated to version 2 by replacing the relationship with the appropriate `parent` field and adding `created` and `updated` timestamps.
