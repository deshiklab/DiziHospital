<?php

declare(strict_types=1);

namespace App\Modules\Messaging\Senders;

use App\Support\ProblemException;
use Illuminate\Support\Facades\Mail;
use Throwable;

/**
 * E-mail, through whatever relay the deployment has.
 *
 * The rule this driver exists to enforce: **a transport that does not deliver is a refusal, not a note in a log
 * file.** Laravel's `log` mailer accepts every message and writes it to `laravel.log`, which in a pilot deployment is
 * indistinguishable from success until a patient says nobody e-mailed them. So `log` — and any other transport that
 * keeps mail inside the process — is refused here with a 502 that names it, and the delivery log shows a failed
 * attempt with the reason. `array` is allowed because it is the transport the tests use and it keeps what it was
 * given; a real deployment sets `MAIL_MAILER=smtp`.
 *
 * Attachments are deliberately absent: the contract's own rule is that nothing clinical leaves by message, and a
 * clinical document goes through the Download Centre where a share can be withdrawn.
 *
 * As with the WhatsApp driver: no mail has left this repository. The refusal shape and the body are tested; the relay
 * is not.
 */
final class SmtpSender implements Sender
{
    /** Transports that accept a message and deliver it nowhere. Naming them is the point: they are refused. */
    private const PRETENDERS = ['log', 'null'];

    public function __construct(private readonly string $from) {}

    public function name(): string
    {
        return 'smtp';
    }

    public function send(string $to, ?string $subject, string $body, string $template = ''): ?string
    {
        $transport = (string) config('mail.default');

        if (in_array($transport, self::PRETENDERS, true)) {
            throw $this->refuse("the mail transport is `{$transport}`, which accepts every message and delivers nothing.");
        }

        if ($this->from === '') {
            throw $this->refuse('this deployment has no sender address, so the message would arrive from nowhere and be discarded.');
        }

        try {
            Mail::raw($body, static function ($message) use ($to, $subject): void {
                $message->to($to)->subject($subject ?? 'Dizi Hospital');
            });
        } catch (Throwable $failed) {
            throw $this->refuse('the relay refused it: '.$failed->getMessage());
        }

        /* The relay's own id is not available from the `array` transport, and an invented one would be worse than
           none: the log keeps what the carrier said, and "the relay accepted it" is all this driver can honestly
           claim. */
        return null;
    }

    private function refuse(string $because): ProblemException
    {
        return ProblemException::of(
            'dizi.unavailable',
            'The gateway is unreachable',
            502,
            'This message was not sent: '.$because
            .' Nothing was e-mailed, and the attempt is in the delivery log with the reason — the desk can print the copy instead of telling the patient to check an inbox nobody wrote to.',
        );
    }
}
