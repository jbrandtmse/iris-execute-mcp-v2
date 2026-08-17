/// Unit tests for Story 34.8's UTF-8 request-body decode fix:
/// <class>ExecuteMCPv2.Utils</class>.<method>DecodeUtf8Stream</method> and
/// <method>IncompleteUtf8TailLength</method>.
/// <p>These exercise the decode MECHANISM directly against synthetic raw-byte streams —
/// no live <var>%request</var>/CSP context is available inside <class>%UnitTest.TestCase</class>
/// (see <class>ExecuteMCPv2.Tests.BaseTest</class>'s own note on this), so the end-to-end
/// "does the real deployed <c>/command</c> and <c>/classmethod</c> route actually use this
/// correctly" proof lives in the TS default suite instead (AC 34.8.6), which drives the
/// real endpoint over genuine HTTP with a wire body that is ACTUALLY UTF-8 encoded by a
/// real client, not synthesized.</p>
/// <p>Every raw byte fixture below is the VERIFIED UTF-8 encoding of a real character —
/// cross-checked against the exact byte sequence live-captured from
/// <property>%request.Content</property> during this story's AC 34.8.1 probe (disposable
/// <c>ExecuteMCPv2.Temp.Utf8Probe</c>, deleted before commit): é = 195,169; 世 = 228,184,150;
/// 界 = 231,149,140; 😀 = 240,159,152,128. Rule #54: these are RAW BYTES (0-255), not the
/// already-decoded wide character — e.g. é's raw UTF-8 bytes are <code>$Char(195,169)</code>,
/// never <code>$Char(233)</code> (é's OWN code point, which is what a correctly-decoded
/// RESULT looks like, not what production ever receives on the wire).</p>
Class ExecuteMCPv2.Tests.Utf8DecodeTest Extends %UnitTest.TestCase
{

/// Build a raw binary stream from a %String whose individual characters are already the
/// raw byte values (0-255) to write.
ClassMethod RawStream(pRawBytes As %String) As %Stream.Object
{
    Set tStream = ##class(%Stream.TmpBinary).%New()
    Do tStream.Write(pRawBytes)
    Do tStream.Rewind()
    Quit tStream
}

/// Read a stream's full content back out as a %String, from the start.
ClassMethod ReadAll(pStream As %Stream.Object) As %String
{
    Do pStream.Rewind()
    Quit pStream.Read(pStream.Size)
}

// ── IncompleteUtf8TailLength — direct boundary-detection cases ─────────────────────

Method TestIncompleteUtf8TailLengthEmptyChunk() As %Status
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength(""), 0, "an empty chunk has nothing incomplete")
    Quit $$$OK
}

Method TestIncompleteUtf8TailLengthPureAscii() As %Status
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength("hello world"), 0, "pure ASCII is always complete")
    Quit $$$OK
}

Method TestIncompleteUtf8TailLengthCompleteTwoByteSequence() As %Status
{
    Set tChunk = "a"_$Char(195,169)
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength(tChunk), 0, "a complete 2-byte sequence at the end is not incomplete")
    Quit $$$OK
}

Method TestIncompleteUtf8TailLengthLoneTwoByteLead() As %Status
{
    Set tChunk = "a"_$Char(195)
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength(tChunk), 1, "a lone 2-byte lead byte at the end needs 1 byte held back")
    Quit $$$OK
}

Method TestIncompleteUtf8TailLengthCompleteThreeByteSequence() As %Status
{
    Set tChunk = "a"_$Char(228,184,150)
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength(tChunk), 0, "a complete 3-byte sequence at the end is not incomplete")
    Quit $$$OK
}

Method TestIncompleteUtf8TailLengthThreeByteLeadPlusOneContinuation() As %Status
{
    Set tChunk = "a"_$Char(228,184)
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength(tChunk), 2, "a 3-byte lead with only 1 of 2 continuation bytes needs 2 held back")
    Quit $$$OK
}

Method TestIncompleteUtf8TailLengthLoneThreeByteLead() As %Status
{
    Set tChunk = "a"_$Char(228)
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength(tChunk), 1, "a lone 3-byte lead byte needs 1 held back")
    Quit $$$OK
}

Method TestIncompleteUtf8TailLengthCompleteFourByteSequence() As %Status
{
    Set tChunk = "a"_$Char(240,159,152,128)
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength(tChunk), 0, "a complete 4-byte sequence at the end is not incomplete")
    Quit $$$OK
}

Method TestIncompleteUtf8TailLengthFourByteLeadPlusTwoContinuations() As %Status
{
    Set tChunk = "a"_$Char(240,159,152)
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength(tChunk), 3, "a 4-byte lead with only 2 of 3 continuation bytes needs 3 held back")
    Quit $$$OK
}

Method TestIncompleteUtf8TailLengthFourByteLeadPlusOneContinuation() As %Status
{
    Set tChunk = "a"_$Char(240,159)
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength(tChunk), 2, "a 4-byte lead with only 1 of 3 continuation bytes needs 2 held back")
    Quit $$$OK
}

Method TestIncompleteUtf8TailLengthLoneFourByteLead() As %Status
{
    Set tChunk = "a"_$Char(240)
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength(tChunk), 1, "a lone 4-byte lead byte needs 1 held back")
    Quit $$$OK
}

/// Chunks too short to look back the full 3-byte distance must not error, and must
/// default to "complete" (0) rather than run off the start of the string.
Method TestIncompleteUtf8TailLengthShortChunkGuards() As %Status
{
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength($Char(169)), 0, "a single lone continuation byte with nothing before it defaults to complete")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength($Char(184,150)), 0, "two lone continuation bytes with nothing before them default to complete")
    ; Story 34.8 code review: the `tB2 < 128` arm (an ASCII byte immediately before a
    ; trailing continuation byte — a malformed orphan, nothing to hold back) was the one
    ; branch in IncompleteUtf8TailLength that no fixture in this file reached.
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength("a"_$Char(128)), 0, "an ASCII byte before a trailing continuation byte is an orphan, not an incomplete sequence")
    Do $$$AssertEquals(##class(ExecuteMCPv2.Utils).IncompleteUtf8TailLength("ab"_$Char(128,128)), 0, "two continuation bytes preceded by ASCII are orphans, not an incomplete sequence")
    Quit $$$OK
}

// ── DecodeUtf8Stream — AC 34.8.5 ASCII byte-identity (back-compat proof) ───────────

/// Rule #19 mechanical back-compat proof: pure ASCII content is byte-for-byte identical
/// after chunked UTF-8 decode. A deliberately tiny 7-byte chunk size forces ASCII content
/// ACROSS many chunk boundaries too — proving the boundary machinery is a true no-op for
/// ASCII, not merely "happens not to matter" at the large production chunk size.
Method TestDecodeUtf8StreamAsciiByteIdentical() As %Status
{
    Set tAscii = "The quick brown fox jumps over the lazy dog 0123456789 !@#$%^&*()_+-=[]{}|;:,.<>/?"
    Set tStream = ..RawStream(tAscii)
    Set tDecodedStream = ##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream, 7)
    Set tDecoded = ..ReadAll(tDecodedStream)
    Do $$$AssertEquals(tDecoded, tAscii, "pure ASCII content must be byte-identical after chunked UTF-8 decode")
    Quit $$$OK
}

/// Every ASCII code point 0-127 (including control characters) round-trips unchanged.
Method TestDecodeUtf8StreamAllAsciiCodePointsByteIdentical() As %Status
{
    Set tAscii = ""
    For tCode=0:1:127 {
        Set tAscii = tAscii _ $Char(tCode)
    }
    Set tStream = ..RawStream(tAscii)
    Set tDecodedStream = ##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream, 11)
    Set tDecoded = ..ReadAll(tDecodedStream)
    Do $$$AssertEquals($Length(tDecoded), 128, "all 128 ASCII code points must be present in the decoded output")
    Do $$$AssertEquals(tDecoded, tAscii, "every ASCII code point 0-127 must be byte-identical after chunked UTF-8 decode")
    Quit $$$OK
}

// ── DecodeUtf8Stream — AC 34.8.3 chunk-boundary safety ─────────────────────────────

/// Rule #58 fixture diversity + the story's own named trap (Trap #1): a body containing
/// 2-, 3-, and 4-byte UTF-8 characters back to back, decoded with a deliberately tiny
/// 5-byte chunk size so several chunk boundaries are GUARANTEED to land mid-sequence —
/// exactly the scenario a naive per-chunk $ZCONVERT would corrupt.
Method TestDecodeUtf8StreamChunkBoundarySafety() As %Status
{
    ; Raw UTF-8 bytes for: a é 世 界 😀 z  (ASCII, 2-byte, 3-byte x2, 4-byte, ASCII)
    Set tRawBytes = "a"_$Char(195,169)_$Char(228,184,150)_$Char(231,149,140)_$Char(240,159,152,128)_"z"
    Set tExpected = "a"_$Char(233)_$Char(19990)_$Char(30028)_$Char(55357,56832)_"z"

    Set tStream = ..RawStream(tRawBytes)
    Set tDecodedStream = ##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream, 5)
    Set tDecoded = ..ReadAll(tDecodedStream)
    Do $$$AssertEquals(tDecoded, tExpected, "a 5-byte chunk size must not corrupt 2/3/4-byte sequences straddling chunk boundaries")

    ; Cross-check against a single-chunk (no boundary at all) decode of the SAME raw
    ; bytes — the real oracle for "chunking changed nothing about the result".
    Set tStream2 = ..RawStream(tRawBytes)
    Set tWholeDecodedStream = ##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream2, 1000000)
    Set tWholeDecoded = ..ReadAll(tWholeDecodedStream)
    Do $$$AssertEquals(tDecoded, tWholeDecoded, "the tiny-chunk decode must match the single-chunk decode of the identical raw bytes")
    Quit $$$OK
}

/// Sweeps EVERY chunk size from 1 up to the raw byte sequence's own length, so every
/// possible boundary position is exercised at least once — not just one hand-picked
/// chunk size that might accidentally avoid the worst offset.
Method TestDecodeUtf8StreamChunkBoundarySweep() As %Status
{
    Set tRawBytes = "start-"_$Char(195,169)_"-"_$Char(228,184,150)_$Char(231,149,140)_"-"_$Char(240,159,152,128)_"-end"
    Set tExpected = "start-"_$Char(233)_"-"_$Char(19990)_$Char(30028)_"-"_$Char(55357,56832)_"-end"
    Set tRawLen = $Length(tRawBytes)

    For tChunkSize=1:1:tRawLen {
        Set tStream = ..RawStream(tRawBytes)
        Set tDecodedStream = ##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream, tChunkSize)
        Set tDecoded = ..ReadAll(tDecodedStream)
        Do $$$AssertEquals(tDecoded, tExpected, "chunk size "_tChunkSize_" must decode identically to the unchunked result")
    }
    Quit $$$OK
}

// ── DecodeUtf8Stream — AC 34.8.4 large-body safety ──────────────────────────────────

/// Trap #2: a raw stream comfortably past the platform's practical long-string ceiling
/// must decode without &lt;MAXSTRING&gt; and without silent data loss. Built via repeated
/// Write calls of a moderate-sized block (never one giant concatenation) — matching how a
/// real large HTTP body already exists in a stream, not how it gets there.
Method TestDecodeUtf8StreamLargeBodyNoMaxString() As %Status
{
    Set tUnit = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-"_$Char(195,169)_"-"_$Char(228,184,150)_"-"_$Char(240,159,152,128)_"-"
    Set tBlock = ""
    For i=1:1:1000 { Set tBlock = tBlock_tUnit }
    Set tStream = ##class(%Stream.TmpBinary).%New()
    ; ~70,000 bytes/block x 60 blocks = ~4,200,000 raw bytes — comfortably past the
    ; classic ~3.6M long-string ceiling.
    For i=1:1:60 { Do tStream.Write(tBlock) }
    Set tRawSize = tStream.Size
    Do tStream.Rewind()

    Set tThrew = 0
    Set tDecodedStream = ""
    Try {
        Set tDecodedStream = ##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream)
    } Catch ex {
        Set tThrew = 1
        Set tExMsg = ex.DisplayString()
    }
    Do $$$AssertTrue('tThrew, "decoding a "_tRawSize_"-byte stream must not throw (e.g. <MAXSTRING>): "_$Get(tExMsg))
    Do $$$AssertTrue($IsObject(tDecodedStream), "a decoded stream object must be returned")

    ; Correctness spot-check: the first unit's worth of decoded content must match a
    ; direct decode of one isolated unit (well under any ceiling).
    Set tExpectedUnit = $ZConvert(tUnit, "I", "UTF8")
    Do tDecodedStream.Rewind()
    Set tFirstSlice = tDecodedStream.Read($Length(tExpectedUnit))
    Do $$$AssertEquals(tFirstSlice, tExpectedUnit, "the first decoded unit must match an isolated direct decode of the same raw bytes")

    ; ── Story 34.8 code review: the assertions ABOVE cannot detect silent truncation ──
    ; Proven live during review: a decode regressed to a single .Read(stream.Size) — the
    ; exact Trap-3 shape this method exists to avoid — still yields no throw, a real stream
    ; object, and a correct FIRST slice, while silently losing ~800,000 characters. Without
    ; the two assertions below, the one property AC 34.8.4 is about was the one property
    ; untested. Both are derived mechanically from the fixture, never hard-coded.
    Set tExpectedSize = $Length(tExpectedUnit) * 1000 * 60
    Do $$$AssertEquals(tDecodedStream.Size, tExpectedSize, "the FULL decoded length must be present — a silently truncated read (no exception, just less data) must fail here")
    ; Rolling sequential tail read (a few large Reads). Deliberately NOT MoveTo() — measured
    ; at ~26s on this fixture, versus well under a second this way.
    Set tUnitLen = $Length(tExpectedUnit)
    Do tDecodedStream.Rewind()
    Set tTailBuf = ""
    While 'tDecodedStream.AtEnd {
        Set tTailBuf = tTailBuf_tDecodedStream.Read(1000000)
        If $Length(tTailBuf) > tUnitLen {
            Set tTailBuf = $Extract(tTailBuf, $Length(tTailBuf) - tUnitLen + 1, *)
        }
    }
    Do $$$AssertEquals(tTailBuf, tExpectedUnit, "the LAST decoded unit must also be intact — proving the tail past the ~3.6M single-read ceiling was neither dropped nor corrupted")
    Quit $$$OK
}

/// Story 34.8 code review — a non-positive <var>pChunkSize</var> must fall back to the
/// default, never be used as a literal chunk size. Live-verified during review that
/// <code>.Read(0)</code> returns the empty string WITHOUT setting <property>AtEnd</property>,
/// so a literal 0 would make <method>DecodeUtf8Stream</method>'s read loop spin forever and
/// hang the job. The pre-existing chunk-size sweep starts at 1, so 0 was the one value never
/// exercised. This test completing AT ALL is the assertion that matters.
Method TestDecodeUtf8StreamZeroChunkSizeFallsBackAndTerminates() As %Status
{
    Set tRawBytes = "ab"_$Char(240,159,152,128)_"cd"
    Set tExpected = "ab"_$Char(55357,56832)_"cd"
    Set tStream = ..RawStream(tRawBytes)
    Set tDecoded = ..ReadAll(##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream, 0))
    Do $$$AssertEquals(tDecoded, tExpected, "chunk size 0 must fall back to the default chunk size, terminate, and decode correctly")
    Quit $$$OK
}

/// Story 34.8 code review — closes the gap between the QA write-up's claim ("a lone lead
/// byte of every length (2/3/4-byte) at absolute end-of-stream, with 0/1/2 of its
/// continuation bytes present") and what was actually pinned: only the 3-byte lone-lead case
/// existed. Every truncated trailing sequence must be flushed exactly once and must never
/// throw, and the well-formed leading text must always survive intact.
Method TestDecodeUtf8StreamTruncatedTrailingSequenceEveryLeadLength() As %Status
{
    Set tCases = $ListBuild($Char(195), $Char(228), $Char(228,184), $Char(240), $Char(240,159), $Char(240,159,152))
    For i=1:1:$ListLength(tCases) {
        Set tTail = $List(tCases, i)
        Set tRawBytes = "head-"_tTail
        Set tThrew = 0
        Set tDecoded = ""
        Try {
            Set tDecoded = ..ReadAll(##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(..RawStream(tRawBytes), 100))
        } Catch ex {
            Set tThrew = 1
        }
        Do $$$AssertTrue('tThrew, "truncated trailing sequence case "_i_" must not throw")
        Do $$$AssertEquals($Extract(tDecoded, 1, 5), "head-", "the well-formed leading text must survive truncated trailing case "_i)
    }
    Quit $$$OK
}

// ── DecodeUtf8Stream — edge cases ────────────────────────────────────────────────────

Method TestDecodeUtf8StreamEmptyStream() As %Status
{
    Set tStream = ##class(%Stream.TmpBinary).%New()
    Do tStream.Rewind()
    Set tDecodedStream = ##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream)
    Do $$$AssertTrue($IsObject(tDecodedStream), "an empty raw stream must still return a stream object")
    Do tDecodedStream.Rewind()
    Do $$$AssertEquals(tDecodedStream.Size, 0, "an empty raw stream must decode to an empty stream")
    Quit $$$OK
}

/// A multi-byte character occupying the VERY FIRST bytes of the stream, with a chunk
/// size SMALLER than the sequence itself — the first chunk read must not mis-handle a
/// sequence starting at position 1.
Method TestDecodeUtf8StreamMultiByteAtVeryStart() As %Status
{
    Set tRawBytes = $Char(240,159,152,128)_"-tail"
    Set tExpected = $Char(55357,56832)_"-tail"
    Set tStream = ..RawStream(tRawBytes)
    Set tDecodedStream = ##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream, 3)
    Set tDecoded = ..ReadAll(tDecodedStream)
    Do $$$AssertEquals(tDecoded, tExpected, "a multi-byte sequence at the very start of the stream, with a chunk size smaller than the sequence, must decode correctly")
    Quit $$$OK
}

/// A genuinely truncated trailing sequence AT END OF STREAM (not a chunk-boundary
/// artifact — the whole stream ends mid-sequence) must not throw; the final flush
/// decodes whatever is left as-is rather than silently dropping it.
Method TestDecodeUtf8StreamGenuinelyTruncatedTrailingSequenceDoesNotThrow() As %Status
{
    Set tRawBytes = "head-"_$Char(228)
    Set tStream = ..RawStream(tRawBytes)
    Set tThrew = 0
    Set tDecoded = ""
    Try {
        Set tDecodedStream = ##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream, 100)
        Set tDecoded = ..ReadAll(tDecodedStream)
    } Catch ex {
        Set tThrew = 1
    }
    Do $$$AssertTrue('tThrew, "a genuinely truncated trailing sequence at end-of-stream must not throw")
    Do $$$AssertTrue(tDecoded [ "head-", "the well-formed leading portion must still be present")
    Quit $$$OK
}

/// Mixed ASCII + non-ASCII in the SAME chunk, with the multi-byte character positioned
/// so the chunk boundary lands exactly between two of its continuation bytes (Rule #58:
/// not just "a boundary somewhere", but the specific worst-case offset).
Method TestDecodeUtf8StreamMixedAsciiNonAsciiExactBoundarySplit() As %Status
{
    ; "ab" (2 bytes) + 界 (3 bytes: 231,149,140) + "cd" (2 bytes) = 7 raw bytes.
    ; Chunk size 4 splits exactly after the SECOND byte of the 3-byte sequence
    ; (positions: a=1,b=2,231=3,149=4 | 140=5,c=6,d=7).
    Set tRawBytes = "ab"_$Char(231,149,140)_"cd"
    Set tExpected = "ab"_$Char(30028)_"cd"
    Set tStream = ..RawStream(tRawBytes)
    Set tDecodedStream = ##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream, 4)
    Set tDecoded = ..ReadAll(tDecodedStream)
    Do $$$AssertEquals(tDecoded, tExpected, "a chunk boundary landing between the 2nd and 3rd bytes of a 3-byte sequence must not corrupt it")
    Quit $$$OK
}

// ── DecodeUtf8Stream — AC 34.8.3 astral sequence split at EACH interior position ────

/// QA pass (2026-08-16): the 4-byte 😀 sequence (240,159,152,128) split at each of its 3
/// interior positions individually, not just swept incidentally by the chunk-size sweep
/// test above. "AB" (2 bytes) prefixes the sequence so chunk size 3/4/5 forces the first
/// stream .Read() boundary to land after the 1st/2nd/3rd byte of the 4-byte sequence
/// respectively.
Method TestDecodeUtf8StreamAstralSequenceSplitAtEachInteriorPosition() As %Status
{
    Set tRawBytes = "AB"_$Char(240,159,152,128)_"CD"
    Set tExpected = "AB"_$Char(55357,56832)_"CD"

    Set tStream1 = ..RawStream(tRawBytes)
    Set tDecoded1 = ..ReadAll(##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream1, 3))
    Do $$$AssertEquals(tDecoded1, tExpected, "split after the 1st of 4 bytes (chunk=3) must decode correctly")

    Set tStream2 = ..RawStream(tRawBytes)
    Set tDecoded2 = ..ReadAll(##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream2, 4))
    Do $$$AssertEquals(tDecoded2, tExpected, "split after the 2nd of 4 bytes (chunk=4) must decode correctly")

    Set tStream3 = ..RawStream(tRawBytes)
    Set tDecoded3 = ..ReadAll(##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream3, 5))
    Do $$$AssertEquals(tDecoded3, tExpected, "split after the 3rd of 4 bytes (chunk=5) must decode correctly")
    Quit $$$OK
}

/// QA pass (2026-08-16): body length an EXACT multiple of the chunk size (12 raw bytes,
/// chunk size 4 -> exactly 3 full reads, nothing left over on the final iteration) must
/// decode identically to a single-shot oracle decode of the same bytes.
Method TestDecodeUtf8StreamExactMultipleOfChunkSize() As %Status
{
    Set tRawBytes = "AB"_$Char(240,159,152,128)_"CD"_$Char(228,184,150)_"E"
    Set tExpected = "AB"_$Char(55357,56832)_"CD"_$Char(19990)_"E"
    Do $$$AssertEquals($Length(tRawBytes), 12, "fixture must be exactly 12 raw bytes for this test to mean what it says")

    Set tStream = ..RawStream(tRawBytes)
    Set tDecoded = ..ReadAll(##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream, 4))
    Do $$$AssertEquals(tDecoded, tExpected, "a body length that is an exact multiple of the chunk size must decode identically to the oracle")
    Quit $$$OK
}

// ── DecodeUtf8Stream — invalid (not merely incomplete) UTF-8: determine and pin ─────

/// QA pass (2026-08-16): an orphan continuation byte (0x80) with no valid lead byte before
/// it is NOT a chunk-boundary-incomplete case (see <method>IncompleteUtf8TailLength</method>
/// — it is not held back) — it reaches <code>$ZConvert</code> directly. Live-determined
/// behavior: IRIS substitutes a literal <code>?</code>, matching the platform's own
/// established convention for other invalid byte sequences. Pinned so this exact behavior
/// cannot drift silently.
Method TestDecodeUtf8StreamOrphanContinuationByteBecomesQuestionMark() As %Status
{
    Set tRawBytes = "a"_$Char(128)_"b"
    Set tStream = ..RawStream(tRawBytes)
    Set tDecoded = ..ReadAll(##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream))
    Do $$$AssertEquals(tDecoded, "a?b", "an orphan continuation byte with no valid lead must decode as a literal ? sandwiched between the surrounding valid ASCII")
    Quit $$$OK
}

/// QA pass (2026-08-16): an overlong encoding (0xC0 0xAF — a non-canonical 2-byte
/// encoding of '/', U+002F, which conformant UTF-8 per RFC 3629 must reject) is NOT
/// rejected by <code>$ZConvert(...,"I","UTF8")</code> — it is decoded leniently to the
/// character the bit pattern spells out. Live-determined and pinned so this platform
/// characteristic (more permissive than strict UTF-8) is documented rather than an
/// unpinned surprise.
Method TestDecodeUtf8StreamOverlongEncodingDecodesLeniently() As %Status
{
    Set tRawBytes = $Char(192,175)
    Set tStream = ..RawStream(tRawBytes)
    Set tDecoded = ..ReadAll(##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream))
    Do $$$AssertEquals(tDecoded, "/", "an overlong-encoded '/' is leniently decoded to '/' rather than rejected")
    Quit $$$OK
}

/// QA pass (2026-08-16) — the defect this fix's own QA pass found and closed: a malformed
/// 3-byte WTF-8/CESU-8 sequence (0xED 0xA0 0x80) is never valid UTF-8 (RFC 3629 excludes
/// the whole surrogate block from UTF-8) but <code>$ZConvert</code> decodes it anyway into
/// the raw UTF-16 high-surrogate code unit 55296. Live-verified BEFORE
/// <method>SanitizeUnpairedSurrogates</method> existed: that raw surrogate reached a real
/// HTTP response and a strict decoder threw on the resulting bytes (genuinely invalid
/// UTF-8, HTTP 200, no error). This pins the fix: the lone surrogate must never survive as
/// a raw code unit — it becomes a literal <code>?</code>, the same substitution
/// <code>$ZConvert</code> itself uses for other invalid sequences.
Method TestDecodeUtf8StreamMalformedWtf8LoneHighSurrogateBecomesQuestionMark() As %Status
{
    Set tRawBytes = "pre-"_$Char(237,160,128)_"-post"
    Set tStream = ..RawStream(tRawBytes)
    Set tDecoded = ..ReadAll(##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream))
    Do $$$AssertEquals(tDecoded, "pre-?-post", "a WTF-8-encoded lone HIGH surrogate must decode to a literal ?, never the raw surrogate code unit")
    Quit $$$OK
}

/// Same as above for the LOW-surrogate WTF-8 encoding (0xED 0xB0 0x80 -> raw code unit
/// 56320 before the fix).
Method TestDecodeUtf8StreamMalformedWtf8LoneLowSurrogateBecomesQuestionMark() As %Status
{
    Set tRawBytes = "pre-"_$Char(237,176,128)_"-post"
    Set tStream = ..RawStream(tRawBytes)
    Set tDecoded = ..ReadAll(##class(ExecuteMCPv2.Utils).DecodeUtf8Stream(tStream))
    Do $$$AssertEquals(tDecoded, "pre-?-post", "a WTF-8-encoded lone LOW surrogate must decode to a literal ?, never the raw surrogate code unit")
    Quit $$$OK
}

// ── SanitizeUnpairedSurrogates — direct unit coverage ───────────────────────────────

/// A genuinely valid surrogate pair (a real astral character, e.g. 😀's UTF-16 pair
/// 55357,56832) must be left completely untouched.
Method TestSanitizeUnpairedSurrogatesLeavesValidPairUntouched() As %Status
{
    Set tInput = "a"_$Char(55357,56832)_"b"
    Set tResult = ##class(ExecuteMCPv2.Utils).SanitizeUnpairedSurrogates(tInput)
    Do $$$AssertEquals(tResult, tInput, "a genuine surrogate pair must not be altered")
    Quit $$$OK
}

/// A lone high surrogate with no low-surrogate partner immediately after it (end of
/// string) must be replaced with ?.
Method TestSanitizeUnpairedSurrogatesReplacesLoneHighSurrogateAtEnd() As %Status
{
    Set tInput = "a"_$Char(55296)
    Set tResult = ##class(ExecuteMCPv2.Utils).SanitizeUnpairedSurrogates(tInput)
    Do $$$AssertEquals(tResult, "a?", "a lone high surrogate at the end of the string must become ?")
    Quit $$$OK
}

/// A lone low surrogate with no high-surrogate partner immediately before it (start of
/// string) must be replaced with ?.
Method TestSanitizeUnpairedSurrogatesReplacesLoneLowSurrogateAtStart() As %Status
{
    Set tInput = $Char(56320)_"a"
    Set tResult = ##class(ExecuteMCPv2.Utils).SanitizeUnpairedSurrogates(tInput)
    Do $$$AssertEquals(tResult, "?a", "a lone low surrogate at the start of the string must become ?")
    Quit $$$OK
}

/// Two ADJACENT high surrogates (neither has a valid low partner) must each become their
/// OWN ? — not collapsed into one, and not misread as forming a pair with each other.
Method TestSanitizeUnpairedSurrogatesTwoAdjacentHighSurrogatesEachBecomeQuestionMark() As %Status
{
    Set tInput = $Char(55296,55297)
    Set tResult = ##class(ExecuteMCPv2.Utils).SanitizeUnpairedSurrogates(tInput)
    Do $$$AssertEquals(tResult, "??", "two adjacent unpaired high surrogates must each become their own ?")
    Quit $$$OK
}

/// A genuine valid pair immediately followed by an orphan low surrogate: the valid pair
/// must survive untouched and only the orphan gets replaced — proving the scan correctly
/// advances past a consumed pair rather than re-examining the pair's low half as if it
/// were unpaired.
Method TestSanitizeUnpairedSurrogatesValidPairThenOrphanLowSurrogate() As %Status
{
    Set tInput = $Char(55357,56832,56320)
    Set tResult = ##class(ExecuteMCPv2.Utils).SanitizeUnpairedSurrogates(tInput)
    Do $$$AssertEquals(tResult, $Char(55357,56832)_"?", "the valid leading pair must survive untouched; only the trailing orphan low surrogate becomes ?")
    Quit $$$OK
}

/// Non-surrogate content (plain ASCII/BMP) must be returned byte-identical — a true no-op
/// when there is nothing to sanitize (the overwhelmingly common case in production).
Method TestSanitizeUnpairedSurrogatesNoOpOnOrdinaryContent() As %Status
{
    Set tInput = "hello "_$Char(233)_" world "_$Char(19990)
    Set tResult = ##class(ExecuteMCPv2.Utils).SanitizeUnpairedSurrogates(tInput)
    Do $$$AssertEquals(tResult, tInput, "ordinary ASCII/BMP content with no surrogate code units must be returned unchanged")
    Quit $$$OK
}

}
