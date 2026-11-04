# CBT HUB Offline Synchronization Plan

## Goal
Allow students to take CBT exams on a local network without internet.
When internet returns, synchronize saved results with the online CBT HUB.

## Local exam setup
- The administrator runs CBT HUB on a phone or laptop.
- Student laptops connect to the same Wi-Fi router or hotspot.
- Internet access is not required for local exams.
- The administrator's device stays powered on during the exam.

## Offline requirements
1. Download exam questions to the local server before the exam.
2. Allow students to log in and take downloaded exams locally.
3. Save answers and submitted results on the local server.
4. Keep results safely stored if the server restarts.
5. Give every submitted attempt a unique ID.

## Synchronization requirements
1. Detect when internet access is available.
2. Send unsynchronized results to the online server.
3. Verify that the online server saved each result.
4. Mark a result as synchronized only after confirmation.
5. Retry failed synchronization without creating duplicate results.
6. Never delete unsynchronized results automatically.

## Security
- Only authorized administrators can synchronize results.
- Do not send student passwords to the synchronization service.
- Validate exam IDs, student IDs and result data.
- Protect synchronization requests with authentication.

## Important
The existing CBT HUB server does not yet implement these
offline synchronization features. This document is the
implementation plan, not a claim that synchronization is working.
